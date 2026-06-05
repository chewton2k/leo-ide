<script lang="ts">
  import { onMount } from 'svelte';
  import { getVersion, getTauriVersion } from '@tauri-apps/api/app';
  import { open as openUrl } from '@tauri-apps/plugin-shell';
  import { Bug, ExternalLink } from 'lucide-svelte';
  import Icon from '@iconify/svelte';
  import { updaterStatus, checkForUpdates, installUpdate, type UpdaterStatus } from '../../modules';
  import { autostartEnabled, syncAutostart, setAutostart } from '../../modules';

  function statusText(s: UpdaterStatus): string {
    switch (s.kind) {
      case 'checking': return 'Checking…';
      case 'uptodate': return "You're on the latest version.";
      case 'available': return `Update available: v${s.version}`;
      case 'downloading': return s.total ? `Downloading ${Math.round((100 * s.downloaded) / s.total)}%` : 'Downloading…';
      case 'ready': return 'Update ready — restarting…';
      case 'disabled': return "Updates aren't configured for this build.";
      case 'error': return `Update check failed: ${s.message}`;
      default: return '';
    }
  }

  let appVersion = $state('—');
  let tauriVersion = $state('—');
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const osPlatform = /Mac/i.test(userAgent) ? 'macOS'
    : /Win/i.test(userAgent) ? 'Windows'
    : /Linux/i.test(userAgent) ? 'Linux'
    : 'Unknown';
  const osArch = /arm64|aarch64/i.test(userAgent) ? 'arm64'
    : /x86_64|x64|Win64/i.test(userAgent) ? 'x64'
    : '—';

  onMount(async () => {
    try { appVersion = await getVersion(); } catch {}
    try { tauriVersion = await getTauriVersion(); } catch {}
    void syncAutostart();
  });

  async function openExternal(url: string) {
    try { await openUrl(url); } catch {}
  }
</script>

<div class="hero" data-setting="about">
  <img src="/leo.png" alt="leo" class="logo" />
  <div class="title">leo</div>
  <div class="subtitle">A minimal Tauri-based code IDE.</div>
  <div class="version-pill">
    <span class="version-dot" aria-hidden="true"></span>
    <span>Version {appVersion}</span>
  </div>
</div>

<div class="grid">
  <div class="cell"><span class="k">Platform</span><span class="v">{osPlatform} ({osArch})</span></div>
  <div class="cell"><span class="k">Tauri</span><span class="v">{tauriVersion}</span></div>
  <div class="cell"><span class="k">Bundle ID</span><span class="v">com.leo.ide</span></div>
  <div class="cell"><span class="k">License</span><span class="v">Apache 2.0</span></div>
</div>

<div class="links">
  <button class="link-btn" onclick={() => openExternal('https://github.com/')}>
    <Icon icon="simple-icons:github" width={13} height={13} />
    <span>GitHub</span>
    <ExternalLink size={11} class="external" />
  </button>
  <button class="link-btn" onclick={() => openExternal('https://github.com/')}>
    <Bug size={13} />
    <span>Report an issue</span>
    <ExternalLink size={11} class="external" />
  </button>
</div>

<div class="updates" data-setting="updates">
  <button
    class="link-btn"
    onclick={checkForUpdates}
    disabled={$updaterStatus.kind === 'checking' || $updaterStatus.kind === 'downloading'}
  >
    <span>Check for updates</span>
  </button>
  {#if $updaterStatus.kind === 'available'}
    <button class="link-btn" onclick={installUpdate}>Restart &amp; install</button>
  {/if}
  {#if statusText($updaterStatus)}<span class="update-status">{statusText($updaterStatus)}</span>{/if}
</div>

<div class="startup" data-setting="autostart">
  <div class="startup-text">
    <span class="startup-label">Launch on login</span>
    <span class="startup-help">Start leo automatically when you sign in.</span>
  </div>
  <button class="toggle" class:on={$autostartEnabled} onclick={() => setAutostart(!$autostartEnabled)} aria-label="Toggle launch on login">
    <span class="toggle-knob"></span>
  </button>
</div>

<style>
  .hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 28px 0 28px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 24px;
  }
  .logo {
    width: 64px; height: 64px;
    border-radius: 14px;
    margin-bottom: 14px;
  }
  .title {
    font-size: 22px; font-weight: 700;
    color: var(--text-primary);
    letter-spacing: -0.5px;
  }
  .subtitle {
    font-size: 12px;
    color: var(--text-muted);
    margin: 4px 0 14px;
  }

  /* Version pill — replaces the previous monospace string with a small
     status-style chip so the hero feels like a real about pane. */
  .version-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border-radius: 999px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    font-size: 11px;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .version-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--success, var(--accent));
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--success, var(--accent)) 18%, transparent);
  }

  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    background: var(--border);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
  }
  .cell {
    background: var(--bg-tertiary);
    padding: 12px 14px;
    display: flex; justify-content: space-between; align-items: center;
  }
  .k {
    font-size: 10.5px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
  }
  .v {
    font-size: 12px;
    color: var(--text-primary);
    font-family: var(--font-mono, monospace);
  }

  .links {
    display: flex; gap: 10px;
    margin-top: 22px;
    justify-content: center;
    flex-wrap: wrap;
  }
  .link-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    background: var(--bg-surface);
    color: var(--text-primary);
    border: 1px solid var(--border);
    padding: 7px 14px;
    border-radius: 7px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.12s ease, border-color 0.12s ease, transform 0.12s ease;
  }
  .link-btn:hover {
    background: var(--bg-tertiary);
    border-color: color-mix(in srgb, var(--accent) 28%, var(--border));
    transform: translateY(-1px);
  }
  .link-btn:active { transform: translateY(0); }
  .link-btn:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--accent) 50%, transparent);
    outline-offset: 2px;
  }
  .link-btn :global(.external) {
    color: var(--text-muted);
    margin-left: 2px;
  }

  .updates {
    display: flex;
    gap: 10px;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    margin-top: 14px;
  }
  .update-status { font-size: 11px; color: var(--text-muted); }
  .link-btn:disabled { opacity: 0.6; cursor: default; transform: none; }

  .startup {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin: 18px auto 0;
    max-width: 360px;
    padding: 12px 14px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 10px;
  }
  .startup-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .startup-label { font-size: 13px; color: var(--text-primary); }
  .startup-help { font-size: 11px; color: var(--text-muted); line-height: 1.4; }

  .toggle {
    position: relative;
    width: 34px; height: 20px;
    border-radius: 10px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
    flex-shrink: 0;
    padding: 0;
  }
  .toggle:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--accent) 50%, transparent);
    outline-offset: 2px;
  }
  .toggle.on { background: var(--settings-icon, #B34B3C); border-color: var(--settings-icon, #B34B3C); }
  .toggle-knob {
    position: absolute;
    top: 2px; left: 2px;
    width: 14px; height: 14px;
    border-radius: 50%;
    background: var(--text-muted);
    transition: transform 0.15s ease, background 0.15s ease;
  }
  .toggle.on .toggle-knob { transform: translateX(14px); background: #fff; }
</style>
