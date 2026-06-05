use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, State};

use super::{is_within_any_root, to_canon, ProjectRootState};

const DEBOUNCE: Duration = Duration::from_millis(150);
const MAX_WINDOW: Duration = Duration::from_millis(1000);

const SKIP_DIRS: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    ".jj",
    "node_modules",
    "bower_components",
    ".pnpm-store",
    ".yarn",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".astro",
    ".vite",
    ".turbo",
    ".parcel-cache",
    ".angular",
    ".vercel",
    ".netlify",
    ".output",
    ".cache",
    "target",
    "__pycache__",
    ".venv",
    "venv",
    ".tox",
    ".nox",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".ipynb_checkpoints",
    ".eggs",
    ".gradle",
    "obj",
    "vendor",
    "_build",
    "deps",
    ".dart_tool",
    "dist-newstyle",
    ".stack-work",
    ".build",
    "zig-cache",
    "zig-out",
    "cmake-build-debug",
    "cmake-build-release",
    ".idea",
    "coverage",
    ".nyc_output",
    ".terraform",
];

fn is_skipped(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| SKIP_DIRS.contains(&n))
}

#[derive(Default)]
pub struct FsWatchState {
    inner: Mutex<Option<WatchInner>>,
}

impl FsWatchState {
    pub fn release_window(&self, label: &str) {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(inner) = guard.as_mut() {
            inner.release_window(label);
        }
    }
}

struct WatchInner {
    watcher: RecommendedWatcher,
    refcounts: HashMap<PathBuf, usize>,
    by_window: HashMap<String, HashSet<PathBuf>>,
}

impl WatchInner {
    fn watch_one(&mut self, path: PathBuf) {
        let current = self.refcounts.get(&path).copied().unwrap_or(0);
        if current == 0 {
            match self.watcher.watch(&path, RecursiveMode::NonRecursive) {
                Ok(()) => {
                    self.refcounts.insert(path, 1);
                }
                Err(e) => log::debug!("fs_watch add {} failed: {e}", path.display()),
            }
        } else {
            self.refcounts.insert(path, current + 1);
        }
    }

    fn unwatch_one(&mut self, path: &Path) {
        let current = self.refcounts.get(path).copied().unwrap_or(0);
        if current <= 1 {
            self.refcounts.remove(path);
            let _ = self.watcher.unwatch(path);
        } else {
            self.refcounts.insert(path.to_path_buf(), current - 1);
        }
    }

    fn add_for_window(&mut self, label: &str, paths: Vec<PathBuf>) {
        for p in paths {
            if self
                .by_window
                .entry(label.to_string())
                .or_default()
                .insert(p.clone())
            {
                self.watch_one(p);
            }
        }
    }

    fn remove_for_window(&mut self, label: &str, paths: Vec<PathBuf>) {
        if let Some(set) = self.by_window.get_mut(label) {
            let owned: Vec<PathBuf> = paths.into_iter().filter(|p| set.remove(p)).collect();
            for p in owned {
                self.unwatch_one(&p);
            }
        }
    }

    fn release_window(&mut self, label: &str) {
        if let Some(set) = self.by_window.remove(label) {
            for p in set {
                self.unwatch_one(&p);
            }
        }
    }
}

#[derive(Clone, serde::Serialize)]
struct ChangedPayload {
    paths: Vec<String>,
}

fn ensure_started(state: &FsWatchState, app: &AppHandle) -> Result<(), String> {
    let mut guard = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_some() {
        return Ok(());
    }

    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    let watcher = RecommendedWatcher::new(
        move |res| {
            let _ = tx.send(res);
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;

    let app = app.clone();
    std::thread::Builder::new()
        .name("leo-fs-watch".into())
        .spawn(move || drain_loop(rx, app))
        .map_err(|e| e.to_string())?;

    *guard = Some(WatchInner {
        watcher,
        refcounts: HashMap::new(),
        by_window: HashMap::new(),
    });
    Ok(())
}

fn drain_loop(rx: mpsc::Receiver<notify::Result<Event>>, app: AppHandle) {
    loop {
        let first = match rx.recv() {
            Ok(ev) => ev,
            Err(_) => return,
        };

        let mut paths: HashSet<String> = HashSet::new();
        collect(&mut paths, first);

        let deadline = Instant::now() + MAX_WINDOW;
        loop {
            let timeout = DEBOUNCE.min(deadline.saturating_duration_since(Instant::now()));
            match rx.recv_timeout(timeout) {
                Ok(ev) => collect(&mut paths, ev),
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
            if Instant::now() >= deadline {
                break;
            }
        }

        if paths.is_empty() {
            continue;
        }
        let _ = app.emit(
            "fs:changed",
            ChangedPayload {
                paths: paths.into_iter().collect(),
            },
        );
    }
}

fn collect(set: &mut HashSet<String>, ev: notify::Result<Event>) {
    let Ok(ev) = ev else { return };
    if matches!(ev.kind, EventKind::Access(_)) {
        return;
    }
    for p in ev.paths {
        set.insert(to_canon(&p));
    }
}

fn prepare_add(project_root: &ProjectRootState, paths: Vec<String>) -> Vec<PathBuf> {
    paths
        .into_iter()
        .filter_map(|raw| {
            let canonical = std::fs::canonicalize(&raw).ok()?;
            if !canonical.is_dir()
                || is_skipped(&canonical)
                || !is_within_any_root(project_root, &canonical)
            {
                return None;
            }
            Some(canonical)
        })
        .collect()
}

#[tauri::command]
pub fn fs_watch_add(
    window: tauri::WebviewWindow,
    paths: Vec<String>,
    app: AppHandle,
    state: State<'_, FsWatchState>,
    project_root: State<'_, ProjectRootState>,
) -> Result<(), String> {
    let prepared = prepare_add(&project_root, paths);
    if prepared.is_empty() {
        return Ok(());
    }
    ensure_started(&state, &app)?;
    let mut guard = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(inner) = guard.as_mut() {
        inner.add_for_window(window.label(), prepared);
    }
    Ok(())
}

#[tauri::command]
pub fn fs_watch_remove(
    window: tauri::WebviewWindow,
    paths: Vec<String>,
    state: State<'_, FsWatchState>,
) -> Result<(), String> {
    let prepared: Vec<PathBuf> = paths
        .into_iter()
        .map(|raw| std::fs::canonicalize(&raw).unwrap_or_else(|_| PathBuf::from(raw)))
        .collect();
    let mut guard = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(inner) = guard.as_mut() {
        inner.remove_for_window(window.label(), prepared);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skip_filter_matches_basename() {
        assert!(is_skipped(Path::new("/a/b/node_modules")));
        assert!(is_skipped(Path::new("/x/target")));
        assert!(is_skipped(Path::new("/p/obj")));
        assert!(!is_skipped(Path::new("/a/src")));
        assert!(!is_skipped(Path::new("/a/node_modules/pkg")));
    }

    #[test]
    fn collect_ignores_access_and_dedups() {
        let mut set = HashSet::new();
        collect(
            &mut set,
            Ok(Event {
                kind: EventKind::Access(notify::event::AccessKind::Read),
                paths: vec![PathBuf::from("/a/x")],
                attrs: Default::default(),
            }),
        );
        assert!(set.is_empty());

        let modify = || {
            Ok(Event {
                kind: EventKind::Modify(notify::event::ModifyKind::Any),
                paths: vec![PathBuf::from("/a/x")],
                attrs: Default::default(),
            })
        };
        collect(&mut set, modify());
        collect(&mut set, modify());
        assert_eq!(set.len(), 1);
    }
}
