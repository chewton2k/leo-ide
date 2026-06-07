#!/usr/bin/env bash
#
# leo — Linux production build & install script.
#
# Invoked by `npm run tauri:build:linux`. Builds `src-tauri` as Linux bundles
# (.AppImage / .deb / .rpm), verifies the result, and installs it for the
# current user. Also scrubs the legacy `embd` project's on-disk artifacts so
# users upgrading from that name get a clean install.
#
# Usage:
#   scripts/build-linux.sh [flags]
#
# Flags:
#   --no-install        Build but do not install anything.
#   --no-clean          Skip the cargo clean + cache/legacy cleanup steps.
#   --bundles <list>    Comma-separated Tauri bundle targets to build.
#                       Choices: appimage, deb, rpm, all. (default: appimage,deb)
#   --install-deb       Install the built .deb system-wide via apt/dpkg (sudo)
#                       instead of installing the AppImage into ~/.local/bin.
#   --verbose           Enable extra logging (`set -x`).
#   -h | --help         Show this help.
#
# Environment overrides:
#   NEW_PRODUCT         Override the product name (default: leo).
#   NEW_IDENTIFIER      Override the bundle id (default: com.leo.ide).
#   BUNDLES             Same as --bundles.
#   SKIP_INSTALL=1      Same as --no-install.
#   SKIP_CLEAN=1        Same as --no-clean.
#   NO_COLOR=1          Disable colored output.
#
# Note: building .rpm requires `rpmbuild`; building .AppImage downloads
# linuxdeploy on first run. See https://tauri.app for the full toolchain.

# ── Strict mode ────────────────────────────────────────────────────

set -Eeuo pipefail

SCRIPT_NAME="$(basename "$0")"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJ_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Capture the wall-clock start for a final timing line.
BUILD_START_EPOCH="$(date +%s)"

# ── Color / logging ────────────────────────────────────────────────

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
  C_DIM=$'\033[2m'
  C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'
else
  C_RESET='' C_BOLD='' C_DIM='' C_RED='' C_GREEN='' C_YELLOW='' C_BLUE=''
fi

log_step()  { printf '%s▸%s %s\n' "$C_BLUE" "$C_RESET" "$1"; }
log_info()  { printf '  %s%s%s\n'   "$C_DIM"  "$1"       "$C_RESET"; }
log_ok()    { printf '%s✓%s %s\n'   "$C_GREEN" "$C_RESET" "$1"; }
log_warn()  { printf '%s!%s %s\n'   "$C_YELLOW" "$C_RESET" "$1" >&2; }
log_error() { printf '%s✗%s %s\n'   "$C_RED"   "$C_RESET" "$1" >&2; }

# Error trap — prints the failing command + line so CI logs are readable.
on_err() {
  local exit_code=$?
  local line=$1
  local cmd=$2
  log_error "Failed at line ${line}: ${cmd}"
  log_error "Exit code: ${exit_code}"
  exit "$exit_code"
}
trap 'on_err "$LINENO" "$BASH_COMMAND"' ERR

# Interrupt trap — clean exit on Ctrl-C.
trap 'log_warn "Aborted"; exit 130' INT TERM

# ── Flags ──────────────────────────────────────────────────────────

SKIP_INSTALL="${SKIP_INSTALL:-0}"
SKIP_CLEAN="${SKIP_CLEAN:-0}"
INSTALL_DEB=0
VERBOSE=0
BUNDLES="${BUNDLES:-appimage,deb}"

usage() {
  sed -n '2,/^# ── Strict mode/p' "$0" | sed 's/^# \{0,1\}//' | sed '$d'
  exit "$1"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-install) SKIP_INSTALL=1 ;;
    --no-clean)   SKIP_CLEAN=1 ;;
    --install-deb) INSTALL_DEB=1 ;;
    --bundles)    shift; [[ $# -gt 0 ]] || { log_error "--bundles needs a value"; usage 2; }; BUNDLES="$1" ;;
    --verbose)    VERBOSE=1 ;;
    -h|--help)    usage 0 ;;
    *)            log_error "Unknown argument: $1"; usage 2 ;;
  esac
  shift
done

[[ "$VERBOSE" == 1 ]] && set -x

# Expand the "all" shorthand into the full set Tauri supports on Linux.
if [[ "$BUNDLES" == "all" ]]; then
  BUNDLES="appimage,deb,rpm"
fi

# ── Identity ───────────────────────────────────────────────────────

NEW_PRODUCT="${NEW_PRODUCT:-leo}"
NEW_IDENTIFIER="${NEW_IDENTIFIER:-com.leo.ide}"

# Legacy identities are fully scrubbed on install. Add any future rename here
# (both arrays must grow together).
LEGACY_PRODUCTS=("embd")
LEGACY_IDENTIFIERS=("com.embd.ide")

BUNDLE_ROOT="$PROJ_DIR/src-tauri/target/release/bundle"

# ── Preflight ──────────────────────────────────────────────────────

log_step "Preflight"

if [[ "$(uname -s)" != "Linux" ]]; then
  log_error "This script targets Linux. Detected: $(uname -s)"
  log_info "On macOS use: npm run tauri:build"
  exit 1
fi

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log_error "Missing required tool: $1"
    [[ -n "${2:-}" ]] && log_info "Install via: $2"
    exit 1
  fi
}

need node    "https://nodejs.org"
need npm     "ships with node"
need cargo   "https://rustup.rs"
need rustc   "https://rustup.rs"
need npx     "ships with node"

# Tauri 2 on Linux needs the WebKit2GTK 4.1 dev libraries at build time. We
# probe via pkg-config when available; missing pkg-config is only a warning.
if command -v pkg-config >/dev/null 2>&1; then
  if ! pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
    log_error "webkit2gtk-4.1 development files not found"
    log_info "Debian/Ubuntu: sudo apt install libwebkit2gtk-4.1-dev build-essential \\"
    log_info "                curl wget file libxdo-dev libssl-dev \\"
    log_info "                libayatana-appindicator3-dev librsvg2-dev"
    log_info "Fedora:        sudo dnf install webkit2gtk4.1-devel openssl-devel \\"
    log_info "                curl wget file libappindicator-gtk3-devel librsvg2-devel"
    exit 1
  fi
else
  log_warn "pkg-config not found — skipping WebKit2GTK dependency check"
fi

# Node >= 18 required by Vite 7 / Tauri 2 tooling.
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 18 )); then
  log_error "Node $NODE_MAJOR.x detected; need >= 18"
  exit 1
fi

# Ensure deps are installed (but don't force reinstall).
if [[ ! -d "$PROJ_DIR/node_modules" ]]; then
  log_info "node_modules missing — running npm install"
  ( cd "$PROJ_DIR" && npm install --no-audit --no-fund )
fi

# rpm packaging needs rpmbuild; fail early with a clear message if requested.
if [[ ",$BUNDLES," == *",rpm,"* ]] && ! command -v rpmbuild >/dev/null 2>&1; then
  log_error "rpm bundle requested but 'rpmbuild' is not installed"
  log_info "Debian/Ubuntu: sudo apt install rpm"
  log_info "Fedora:        sudo dnf install rpm-build"
  exit 1
fi

log_ok "Environment OK ($(uname -sr), Node $(node -v), $(rustc --version | awk '{print $1, $2}'))"
log_info "Bundles: $BUNDLES"

# ── Helpers ────────────────────────────────────────────────────────

# Cache-only cleanup for the CURRENT install. Preserves persistent state
# (recent projects, AI conversations, settings) stored under ~/.config and
# ~/.local/share. Honors XDG_* overrides when present.
clean_identifier_caches() {
  local id="$1"
  local cache_home="${XDG_CACHE_HOME:-$HOME/.cache}"
  local targets=(
    "$cache_home/$id"
  )
  for t in "${targets[@]}"; do
    if [[ -e "$t" ]]; then
      rm -rf -- "$t"
    fi
  done
}

# Full scrub for LEGACY ids — remove every trace, including config + data.
# Never run on the current id.
clean_identifier_all() {
  local id="$1"
  clean_identifier_caches "$id"
  local config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
  local data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
  local state_home="${XDG_STATE_HOME:-$HOME/.local/state}"
  local targets=(
    "$config_home/$id"
    "$data_home/$id"
    "$state_home/$id"
  )
  for t in "${targets[@]}"; do
    if [[ -e "$t" ]]; then
      rm -rf -- "$t"
    fi
  done
}

# Graceful process kill: SIGTERM, wait, then SIGKILL if still alive.
kill_process() {
  local name="$1"
  if pgrep -x "$name" >/dev/null 2>&1; then
    log_info "Stopping running $name"
    pkill -x "$name" 2>/dev/null || true
    # Give it up to 3 seconds to exit cleanly before escalating.
    local i=0
    while (( i < 30 )) && pgrep -x "$name" >/dev/null 2>&1; do
      sleep 0.1; ((i++))
    done
    if pgrep -x "$name" >/dev/null 2>&1; then
      pkill -KILL -x "$name" 2>/dev/null || true
    fi
  fi
}

# Format a size for a file or directory (GNU du).
human_size() {
  local path="$1"
  [[ -e "$path" ]] && du -sh "$path" 2>/dev/null | awk '{print $1}' || echo "?"
}

# Find the single newest file matching a glob, or empty string if none.
newest_match() {
  local pattern="$1"
  local newest=""
  local f
  for f in $pattern; do
    [[ -e "$f" ]] || continue
    if [[ -z "$newest" || "$f" -nt "$newest" ]]; then
      newest="$f"
    fi
  done
  printf '%s' "$newest"
}

# Remove orphaned SQLite knowledge stores left over from the pre-JSON
# knowledge backend (migration: rusqlite/bundled SQLite → per-project JSON).
# The current app reads `<hash>.json` in this directory and can no longer read
# these `.db` files, so they are dead data. Only SQLite artifacts are touched;
# the new `.json` stores and everything else are preserved.
clean_legacy_sqlite() {
  local kdir="$HOME/.leo-ide/knowledge"
  [[ -d "$kdir" ]] || return 0

  local removed=0
  local f
  for f in "$kdir"/*.db "$kdir"/*.db-journal "$kdir"/*.db-wal "$kdir"/*.db-shm; do
    [[ -e "$f" ]] || continue
    if rm -f -- "$f"; then
      removed=$((removed + 1))
    fi
  done

  if (( removed > 0 )); then
    log_info "Removed $removed legacy SQLite knowledge file(s) from $kdir"
  fi
}

# ── Step 1: Cleanup ────────────────────────────────────────────────

if [[ "$SKIP_CLEAN" == 1 ]]; then
  log_step "Cleanup (skipped)"
else
  log_step "Cleanup"

  log_info "cargo clean --release"
  ( cd "$PROJ_DIR/src-tauri" && cargo clean --release >/dev/null 2>&1 || true )

  kill_process "$NEW_PRODUCT"
  for legacy in "${LEGACY_PRODUCTS[@]}"; do
    kill_process "$legacy"
  done

  log_info "Clearing ephemeral caches for $NEW_IDENTIFIER"
  clean_identifier_caches "$NEW_IDENTIFIER"

  log_info "Removing legacy SQLite knowledge stores (migrated to JSON)"
  clean_legacy_sqlite

  for legacy_id in "${LEGACY_IDENTIFIERS[@]}"; do
    log_info "Scrubbing legacy data for $legacy_id"
    clean_identifier_all "$legacy_id"
  done
fi

# ── Step 2: Build ──────────────────────────────────────────────────

log_step "Build"
cd "$PROJ_DIR"

# tauri.conf.json pins bundle targets to "app" (macOS). Override here so the
# Linux packagers run regardless of the committed config.
log_info "npx tauri build --bundles $BUNDLES"
npx tauri build --bundles "$BUNDLES"

# The standalone binary is always produced even if a packager is skipped.
BIN_PATH="$PROJ_DIR/src-tauri/target/release/${NEW_PRODUCT}"
if [[ ! -x "$BIN_PATH" ]]; then
  log_error "Build finished but $BIN_PATH was not produced"
  exit 1
fi
log_ok "Built $BIN_PATH ($(human_size "$BIN_PATH"))"

# ── Step 3: Verify bundles ─────────────────────────────────────────

log_step "Verify"

APPIMAGE_PATH=""
DEB_PATH=""
RPM_PATH=""

if [[ ",$BUNDLES," == *",appimage,"* ]]; then
  APPIMAGE_PATH="$(newest_match "$BUNDLE_ROOT/appimage/*.AppImage")"
  if [[ -n "$APPIMAGE_PATH" ]]; then
    log_info "AppImage: $APPIMAGE_PATH ($(human_size "$APPIMAGE_PATH"))"
  else
    log_warn "appimage requested but no .AppImage was found"
  fi
fi

if [[ ",$BUNDLES," == *",deb,"* ]]; then
  DEB_PATH="$(newest_match "$BUNDLE_ROOT/deb/*.deb")"
  if [[ -n "$DEB_PATH" ]]; then
    log_info "deb:      $DEB_PATH ($(human_size "$DEB_PATH"))"
  else
    log_warn "deb requested but no .deb was found"
  fi
fi

if [[ ",$BUNDLES," == *",rpm,"* ]]; then
  RPM_PATH="$(newest_match "$BUNDLE_ROOT/rpm/*.rpm")"
  if [[ -n "$RPM_PATH" ]]; then
    log_info "rpm:      $RPM_PATH ($(human_size "$RPM_PATH"))"
  else
    log_warn "rpm requested but no .rpm was found"
  fi
fi

# ── Step 4: Install ────────────────────────────────────────────────

if [[ "$SKIP_INSTALL" == 1 ]]; then
  log_step "Install (skipped)"
  INSTALL_SUMMARY="(skipped)"
elif [[ "$INSTALL_DEB" == 1 ]]; then
  log_step "Install .deb (system-wide)"

  if [[ -z "$DEB_PATH" ]]; then
    log_error "--install-deb requested but no .deb was built"
    log_info "Re-run with: --bundles deb (or all)"
    exit 1
  fi

  if command -v apt >/dev/null 2>&1; then
    log_info "sudo apt install -y $DEB_PATH"
    sudo apt install -y "$DEB_PATH"
  else
    log_info "sudo dpkg -i $DEB_PATH"
    sudo dpkg -i "$DEB_PATH" || {
      log_warn "dpkg reported missing deps — attempting to fix"
      sudo apt-get install -f -y
    }
  fi
  INSTALL_SUMMARY="$NEW_PRODUCT (system package)"
  log_ok "Installed $NEW_PRODUCT via package manager"
else
  log_step "Install AppImage (~/.local/bin)"

  if [[ -z "$APPIMAGE_PATH" ]]; then
    log_error "No AppImage available to install"
    log_info "Build one with: --bundles appimage  (or use --install-deb)"
    exit 1
  fi

  BIN_DIR="$HOME/.local/bin"
  DESKTOP_DIR="$HOME/.local/share/applications"
  ICON_DIR="$HOME/.local/share/icons/hicolor/128x128/apps"
  DEST_APPIMAGE="$BIN_DIR/${NEW_PRODUCT}.AppImage"
  mkdir -p "$BIN_DIR" "$DESKTOP_DIR" "$ICON_DIR"

  kill_process "$NEW_PRODUCT"

  log_info "Installing AppImage -> $DEST_APPIMAGE"
  install -m 0755 "$APPIMAGE_PATH" "$DEST_APPIMAGE"

  # Install the app icon so the desktop entry shows artwork.
  ICON_SRC="$PROJ_DIR/src-tauri/icons/128x128.png"
  ICON_NAME="$NEW_PRODUCT"
  if [[ -f "$ICON_SRC" ]]; then
    install -m 0644 "$ICON_SRC" "$ICON_DIR/${ICON_NAME}.png"
  else
    ICON_NAME=""  # fall back to no icon
  fi

  # Write a .desktop launcher so leo shows up in the application menu.
  DESKTOP_FILE="$DESKTOP_DIR/${NEW_IDENTIFIER}.desktop"
  {
    printf '[Desktop Entry]\n'
    printf 'Type=Application\n'
    printf 'Name=%s\n' "$NEW_PRODUCT"
    printf 'Comment=A lightweight IDE\n'
    printf 'Exec=%s %%F\n' "$DEST_APPIMAGE"
    [[ -n "$ICON_NAME" ]] && printf 'Icon=%s\n' "$ICON_NAME"
    printf 'Terminal=false\n'
    printf 'Categories=Development;IDE;TextEditor;\n'
    printf 'StartupWMClass=%s\n' "$NEW_PRODUCT"
  } > "$DESKTOP_FILE"
  chmod 0644 "$DESKTOP_FILE"

  # Refresh the desktop database / icon cache when the tools are present.
  command -v update-desktop-database >/dev/null 2>&1 \
    && update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
  command -v gtk-update-icon-cache >/dev/null 2>&1 \
    && gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" >/dev/null 2>&1 || true

  INSTALL_SUMMARY="$DEST_APPIMAGE"
  log_ok "Installed $DEST_APPIMAGE"

  # Helpful nudge if ~/.local/bin isn't on PATH.
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) log_warn "$BIN_DIR is not on your PATH — add it to run 'leo' from a shell" ;;
  esac
fi

# ── Summary ────────────────────────────────────────────────────────

BUILD_ELAPSED=$(( $(date +%s) - BUILD_START_EPOCH ))
printf '\n%s[leo build] Done in %ss%s\n' "$C_BOLD" "$BUILD_ELAPSED" "$C_RESET"
[[ -n "$APPIMAGE_PATH" ]] && printf '%sAppImage:%s %s\n' "$C_DIM" "$C_RESET" "$APPIMAGE_PATH"
[[ -n "$DEB_PATH" ]]      && printf '%sdeb:%s      %s\n' "$C_DIM" "$C_RESET" "$DEB_PATH"
[[ -n "$RPM_PATH" ]]      && printf '%srpm:%s      %s\n' "$C_DIM" "$C_RESET" "$RPM_PATH"
if [[ "$SKIP_INSTALL" != 1 ]]; then
  printf '%sInstalled:%s %s\n' "$C_DIM" "$C_RESET" "$INSTALL_SUMMARY"
fi
