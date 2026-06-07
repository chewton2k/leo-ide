//! Persistent agent shell sessions.
//!
//! Unlike `run_command_capture` (one-shot, fixed cwd), a session keeps its
//! working directory across runs: a `cd` in one `shell_session_run` is visible
//! to the next. Each command runs via `sh -c`, then we append a `pwd` marker to
//! capture the resulting directory and persist it (only if it stays inside the
//! window's project root — the same sandbox every fs/shell command enforces).

use crate::modules::fs::ProjectRootState;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const CWD_MARKER: &str = "__LEO_CWD__";

pub struct ShellSession {
    cwd: Mutex<PathBuf>,
}

pub struct ShellSessionState {
    sessions: Mutex<HashMap<u32, Arc<ShellSession>>>,
    next_id: AtomicU32,
}

impl Default for ShellSessionState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            next_id: AtomicU32::new(1),
        }
    }
}

#[derive(Serialize)]
pub struct SessionRunOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    /// The session's working directory after the command ran.
    pub cwd: String,
}

/// Split a captured stdout into (real stdout, resulting cwd). The cwd is the
/// text after the last `__LEO_CWD__` marker we appended; everything before it
/// is the command's own output.
fn split_cwd_marker(out: &str) -> (String, Option<String>) {
    match out.rfind(CWD_MARKER) {
        Some(idx) => {
            let before = &out[..idx];
            let cwd = out[idx + CWD_MARKER.len()..].trim().to_string();
            // Drop one trailing newline the command left before our marker.
            let before = before.strip_suffix('\n').unwrap_or(before);
            (
                before.to_string(),
                if cwd.is_empty() { None } else { Some(cwd) },
            )
        }
        None => (out.to_string(), None),
    }
}

/// Decide the session's next cwd: take `candidate` only if it stays within
/// `root`; otherwise keep `current` (a `cd` outside the project is not followed).
fn sandbox_cwd(candidate: Option<PathBuf>, current: &Path, root: &Path) -> PathBuf {
    match candidate {
        Some(c) => match std::fs::canonicalize(&c) {
            Ok(canon) if canon.starts_with(root) => canon,
            _ => current.to_path_buf(),
        },
        None => current.to_path_buf(),
    }
}

/// Run one command in `cwd`, returning (stdout, stderr, exit_code, resulting_cwd).
/// Decoupled from Tauri state for testing.
async fn run_in_dir(
    cwd: &Path,
    command: &str,
    dur: Duration,
) -> Result<(String, String, i32, Option<PathBuf>), String> {
    let script = format!("{command}\nprintf '{CWD_MARKER}%s' \"$(pwd)\"");
    let child = tokio::process::Command::new("sh")
        .args(["-c", &script])
        .current_dir(cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn command: {e}"))?;

    let output = tokio::time::timeout(dur, child.wait_with_output())
        .await
        .map_err(|_| "Command timed out".to_string())?
        .map_err(|e| format!("Command failed: {e}"))?;

    let raw_stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let (stdout, cwd_str) = split_cwd_marker(&raw_stdout);
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);
    Ok((stdout, stderr, exit_code, cwd_str.map(PathBuf::from)))
}

/// Resolve a starting cwd within the calling window's project root.
fn resolve_session_cwd(
    window: &tauri::WebviewWindow,
    project_root: &tauri::State<'_, ProjectRootState>,
    cwd: Option<String>,
) -> Result<PathBuf, String> {
    let map = project_root.blocking_read();
    let root = map
        .get(window.label())
        .and_then(|opt| opt.as_ref())
        .ok_or("No project is open. Open a folder first.")?;
    match cwd.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(c) => {
            let canonical = std::fs::canonicalize(c).map_err(|e| format!("Invalid cwd: {e}"))?;
            if !canonical.starts_with(root) {
                return Err("Access denied: cwd is outside the project directory".into());
            }
            Ok(canonical)
        }
        None => Ok(root.clone()),
    }
}

#[tauri::command]
pub fn shell_session_open(
    window: tauri::WebviewWindow,
    project_root: tauri::State<'_, ProjectRootState>,
    state: tauri::State<'_, ShellSessionState>,
    cwd: Option<String>,
) -> Result<u32, String> {
    let start = resolve_session_cwd(&window, &project_root, cwd)?;
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    state.sessions.lock().map_err(|e| e.to_string())?.insert(
        id,
        Arc::new(ShellSession {
            cwd: Mutex::new(start),
        }),
    );
    Ok(id)
}

#[tauri::command]
pub async fn shell_session_run(
    window: tauri::WebviewWindow,
    project_root: tauri::State<'_, ProjectRootState>,
    state: tauri::State<'_, ShellSessionState>,
    id: u32,
    command: String,
    timeout_ms: u64,
) -> Result<SessionRunOutput, String> {
    if crate::modules::shell::policy::is_catastrophic_command(&command) {
        return Err(
            "Refused by safety policy: command appears to perform irreversible destruction"
                .to_string(),
        );
    }
    let session = state
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .get(&id)
        .cloned()
        .ok_or("No such shell session")?;

    let root = {
        let map = project_root.read().await;
        map.get(window.label())
            .and_then(|opt| opt.as_ref())
            .ok_or("No project is open")?
            .clone()
    };

    let cwd = session.cwd.lock().map_err(|e| e.to_string())?.clone();
    let dur = Duration::from_millis(timeout_ms.clamp(1000, 120_000));
    let (stdout, stderr, exit_code, new_cwd) = run_in_dir(&cwd, &command, dur).await?;

    let next = sandbox_cwd(new_cwd, &cwd, &root);
    *session.cwd.lock().map_err(|e| e.to_string())? = next.clone();

    Ok(SessionRunOutput {
        stdout,
        stderr,
        exit_code,
        cwd: next.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn shell_session_close(
    state: tauri::State<'_, ShellSessionState>,
    id: u32,
) -> Result<(), String> {
    state
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_cwd_marker_extracts_dir_and_strips_output() {
        let (out, cwd) = split_cwd_marker("hello\n__LEO_CWD__/home/u/proj");
        assert_eq!(out, "hello");
        assert_eq!(cwd.as_deref(), Some("/home/u/proj"));
    }

    #[test]
    fn split_cwd_marker_handles_no_command_output() {
        let (out, cwd) = split_cwd_marker("__LEO_CWD__/a/b");
        assert_eq!(out, "");
        assert_eq!(cwd.as_deref(), Some("/a/b"));
    }

    #[test]
    fn split_cwd_marker_missing_marker() {
        let (out, cwd) = split_cwd_marker("plain output");
        assert_eq!(out, "plain output");
        assert!(cwd.is_none());
    }

    #[test]
    fn split_cwd_marker_picks_last_when_output_contains_marker() {
        // Command echoed a fake marker; ours (appended last) must win.
        let (out, cwd) = split_cwd_marker("__LEO_CWD__/fake\n__LEO_CWD__/real");
        assert_eq!(out, "__LEO_CWD__/fake");
        assert_eq!(cwd.as_deref(), Some("/real"));
    }

    #[test]
    fn split_cwd_marker_empty_cwd_is_none() {
        let (out, cwd) = split_cwd_marker("done\n__LEO_CWD__");
        assert_eq!(out, "done");
        assert!(cwd.is_none());
    }

    #[test]
    fn sandbox_keeps_cwd_inside_root_and_rejects_outside() {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        let sub = root.join("sub");
        std::fs::create_dir(&sub).unwrap();

        // Inside root -> followed.
        let inside = sandbox_cwd(Some(sub.clone()), &root, &root);
        assert_eq!(inside, std::fs::canonicalize(&sub).unwrap());

        // Outside root -> keep current.
        let outside = sandbox_cwd(Some(PathBuf::from("/tmp")), &root, &root);
        assert_eq!(outside, root);

        // None -> keep current.
        assert_eq!(sandbox_cwd(None, &sub, &root), sub);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn run_in_dir_tracks_cwd_across_cd() {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        std::fs::create_dir(root.join("sub")).unwrap();

        // pwd reflects the starting dir.
        let (_o, _e, code, cwd) = run_in_dir(&root, "true", Duration::from_secs(5))
            .await
            .unwrap();
        assert_eq!(code, 0);
        assert_eq!(std::fs::canonicalize(cwd.unwrap()).unwrap(), root);

        // a `cd` is reflected in the captured cwd.
        let (_o, _e, _c, cwd2) = run_in_dir(&root, "cd sub", Duration::from_secs(5))
            .await
            .unwrap();
        assert_eq!(
            std::fs::canonicalize(cwd2.unwrap()).unwrap(),
            root.join("sub")
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn run_in_dir_captures_stdout_and_exit_code() {
        let dir = tempfile::tempdir().unwrap();
        let (out, _e, code, _cwd) =
            run_in_dir(dir.path(), "printf hi; exit 3", Duration::from_secs(5))
                .await
                .unwrap();
        assert_eq!(out, "hi");
        assert_eq!(code, 3);
    }
}
