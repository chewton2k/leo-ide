use crate::modules::fs::ProjectRootState;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};

pub mod background;
pub mod da_filter;
mod ringbuffer;
pub mod session;
mod shell_init;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

const MAX_SESSIONS: usize = 10;

#[derive(Serialize)]
pub struct SpawnResult {
    pub id: u32,
    pub pid: Option<u32>,
}

pub struct PtyInstance {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    /// PTY reader, held until the frontend calls `terminal_ready`. Deferring
    /// the read loop until the listener is attached guarantees the shell's
    /// startup output (incl. the first OSC 7 cwd report) is never dropped.
    reader: Option<Box<dyn Read + Send>>,
}

pub struct TerminalManager {
    sessions: HashMap<u32, PtyInstance>,
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    pub fn kill_all(&mut self) {
        for (_, mut session) in self.sessions.drain() {
            let _ = session.child.kill();
        }
    }
}

/// Global atomic counter for terminal session IDs. Ensures IDs are unique
/// across all windows, preventing event collision when two windows both
/// listen for `terminal-output-{id}`.
static NEXT_TERMINAL_ID: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);

pub type TerminalState = Arc<Mutex<HashMap<String, TerminalManager>>>;

pub fn create_terminal_state() -> TerminalState {
    Arc::new(Mutex::new(HashMap::new()))
}

#[tauri::command]
pub fn spawn_terminal(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, TerminalState>,
    project_root: tauri::State<'_, ProjectRootState>,
    cwd: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
) -> Result<SpawnResult, String> {
    let label = window.label().to_string();

    // Limit concurrent sessions per window
    {
        let managers = state.lock().map_err(|e| e.to_string())?;
        if let Some(manager) = managers.get(&label) {
            if manager.sessions.len() >= MAX_SESSIONS {
                return Err("Maximum number of terminal sessions reached".to_string());
            }
        }
    }

    // Validate cwd against project root
    let cwd = {
        let map = project_root.blocking_read();
        let root_path = map
            .get(&label)
            .and_then(|opt| opt.as_ref())
            .ok_or_else(|| "No project is open. Open a folder first.".to_string())?;
        let cwd_path = cwd.as_ref().map(std::path::PathBuf::from);
        let dir_to_check = cwd_path.as_deref().unwrap_or(root_path.as_path());
        let canonical =
            std::fs::canonicalize(dir_to_check).map_err(|e| format!("Invalid cwd: {}", e))?;
        if !canonical.starts_with(root_path) {
            return Err("Access denied: terminal cwd is outside the project directory".to_string());
        }
        Some(canonical)
    };

    let pty_system = native_pty_system();

    let initial_rows = rows.unwrap_or(24);
    let initial_cols = cols.unwrap_or(80);

    let pair = pty_system
        .openpty(PtySize {
            rows: initial_rows,
            cols: initial_cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let make_cmd = |login: bool| -> CommandBuilder {
        let mut cmd = if login {
            shell_init::build_login_command()
        } else {
            CommandBuilder::new_default_prog()
        };
        if let Some(dir) = cwd.as_ref() {
            cmd.cwd(dir);
        }
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd
    };

    // Prefer the user's login shell (correct PATH/aliases); fall back to the
    // default program if it can't be spawned.
    let child = match pair.slave.spawn_command(make_cmd(true)) {
        Ok(c) => c,
        Err(e) => {
            log::warn!("login shell spawn failed ({e}); using default program");
            pair.slave
                .spawn_command(make_cmd(false))
                .map_err(|e| e.to_string())?
        }
    };
    let pid = child.process_id();
    drop(pair.slave);

    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    let mut managers = state.lock().map_err(|e| e.to_string())?;
    let manager = managers.entry(label).or_insert_with(TerminalManager::new);
    let id = NEXT_TERMINAL_ID.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    manager.sessions.insert(
        id,
        PtyInstance {
            writer,
            master: pair.master,
            child,
            reader: Some(reader),
        },
    );
    drop(managers);

    // NB: the reader thread is NOT started here. The frontend calls
    // `terminal_ready` once it has attached its `terminal-output-{id}` listener
    // (and OSC handler), at which point we begin streaming — so no startup
    // bytes are emitted into the void and the first cwd report is never lost.
    Ok(SpawnResult { id, pid })
}

/// Begin streaming a PTY's output. Called by the frontend after it has
/// registered its `terminal-output-{id}` listener, eliminating the
/// spawn/listen race that previously dropped the shell's startup OSC 7 (cwd).
/// Idempotent: a second call is a no-op once the reader has been taken.
#[tauri::command]
pub fn terminal_ready(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, TerminalState>,
    app: AppHandle,
    id: u32,
) -> Result<(), String> {
    let reader = {
        let mut managers = state.lock().map_err(|e| e.to_string())?;
        let manager = managers
            .get_mut(window.label())
            .ok_or("No terminal manager for this window")?;
        let session = manager
            .sessions
            .get_mut(&id)
            .ok_or("Terminal session not found")?;
        session.reader.take()
    };
    let Some(mut reader) = reader else {
        return Ok(()); // already streaming
    };

    // Reader thread — emits "terminal-output" events to the spawning window only
    let event_name = format!("terminal-output-{}", id);
    let exit_event_name = format!("terminal-exit-{}", id);
    let window_label = window.label().to_string();
    std::thread::spawn(move || {
        let mut buf = [0u8; 16384];
        let mut pending = Vec::new();
        let target = tauri::EventTarget::WebviewWindow {
            label: window_label.clone(),
        };
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    // Find the last valid UTF-8 boundary to avoid splitting multi-byte chars
                    let valid_len = {
                        let mut len = pending.len();
                        // Walk back up to 3 bytes to find a valid UTF-8 boundary
                        while len > 0 && std::str::from_utf8(&pending[..len]).is_err() {
                            len -= 1;
                        }
                        len
                    };
                    if valid_len > 0 {
                        let data = String::from_utf8_lossy(&pending[..valid_len]).to_string();
                        let _ = app.emit_to(target.clone(), &event_name, data);
                        pending.drain(..valid_len);
                    }
                }
                Err(_) => break,
            }
        }
        // Flush any remaining bytes
        if !pending.is_empty() {
            let data = String::from_utf8_lossy(&pending).to_string();
            let _ = app.emit_to(target.clone(), &event_name, data);
        }
        // Notify frontend that this terminal session has exited
        let _ = app.emit_to(target, &exit_event_name, ());
    });

    Ok(())
}

#[tauri::command]
pub fn write_terminal(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, TerminalState>,
    id: u32,
    data: String,
) -> Result<(), String> {
    let mut managers = state.lock().map_err(|e| e.to_string())?;
    let manager = managers
        .get_mut(window.label())
        .ok_or("No terminal manager for this window")?;
    let session = manager
        .sessions
        .get_mut(&id)
        .ok_or("Terminal session not found")?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    // No flush needed: PTY master fd is unbuffered — the kernel delivers
    // bytes to the slave process immediately after write(). Flushing added
    // one syscall per keystroke with zero benefit.
    Ok(())
}

#[tauri::command]
pub fn kill_terminal(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, TerminalState>,
    id: u32,
) -> Result<(), String> {
    let mut managers = state.lock().map_err(|e| e.to_string())?;
    if let Some(manager) = managers.get_mut(window.label()) {
        if let Some(mut session) = manager.sessions.remove(&id) {
            let _ = session.child.kill();
            std::thread::spawn(move || {
                let _ = session.child.wait();
            });
        }
    }
    Ok(())
}

/// Whether a foreground process other than the shell itself is running in the
/// PTY (e.g. an editor or long task), so the UI can warn before closing.
/// Unix only — returns false on other platforms and when state is unknown.
#[tauri::command]
pub fn pty_has_foreground_process(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, TerminalState>,
    id: u32,
) -> Result<bool, String> {
    let managers = state.lock().map_err(|e| e.to_string())?;
    let Some(session) = managers
        .get(window.label())
        .and_then(|m| m.sessions.get(&id))
    else {
        return Ok(false);
    };
    #[cfg(unix)]
    {
        match (
            session.master.process_group_leader(),
            session.child.process_id(),
        ) {
            (Some(leader), Some(shell)) if leader > 0 => Ok(leader as u32 != shell),
            _ => Ok(false),
        }
    }
    #[cfg(not(unix))]
    {
        let _ = session;
        Ok(false)
    }
}

#[tauri::command]
pub fn resize_terminal(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, TerminalState>,
    id: u32,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let mut managers = state.lock().map_err(|e| e.to_string())?;
    let manager = managers
        .get_mut(window.label())
        .ok_or("No terminal manager for this window")?;
    let session = manager
        .sessions
        .get_mut(&id)
        .ok_or("Terminal session not found")?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Command capture (for agent tool-calling and self-verify) ──

#[derive(Serialize)]
pub struct CommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

/// Run a shell command and capture its output (stdout, stderr, exit code).
/// Used by the agent's run_command tool and self-verify loop.
/// Enforces a timeout to prevent runaway processes.
#[tauri::command]
pub async fn run_command_capture(
    window: tauri::WebviewWindow,
    command: String,
    cwd: String,
    timeout_ms: u64,
    state: tauri::State<'_, ProjectRootState>,
) -> Result<CommandOutput, String> {
    // Validate cwd is within project root (async context — must use .read().await)
    let label = window.label().to_string();
    let root = {
        let map = state.read().await;
        map.get(&label)
            .and_then(|opt| opt.as_ref())
            .ok_or("No project is open")?
            .clone()
    };
    let cwd_path = std::fs::canonicalize(&cwd).map_err(|e| format!("Invalid cwd: {}", e))?;
    if !cwd_path.starts_with(&root) {
        return Err("Access denied: cwd is outside the project directory".into());
    }

    // Spawn the command via sh -c (cross-platform shell execution)
    let child = tokio::process::Command::new("sh")
        .args(["-c", &command])
        .current_dir(&cwd_path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn command: {}", e))?;

    // Wait with timeout
    let timeout = std::time::Duration::from_millis(timeout_ms.clamp(1000, 120_000));
    let output = tokio::time::timeout(timeout, child.wait_with_output())
        .await
        .map_err(|_| format!("Command timed out after {}ms", timeout_ms))?
        .map_err(|e| format!("Command failed: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    Ok(CommandOutput {
        stdout,
        stderr,
        exit_code,
    })
}

pub struct BackgroundState {
    procs: Mutex<HashMap<u32, (String, Arc<background::BackgroundProc>)>>,
    next_id: std::sync::atomic::AtomicU32,
}

impl Default for BackgroundState {
    fn default() -> Self {
        Self {
            procs: Mutex::new(HashMap::new()),
            next_id: std::sync::atomic::AtomicU32::new(1),
        }
    }
}

impl BackgroundState {
    pub fn kill_for_window(&self, label: &str) {
        let mut map = self.procs.lock().unwrap_or_else(|e| e.into_inner());
        map.retain(|_, (owner, proc)| {
            if owner == label {
                proc.kill();
                false
            } else {
                true
            }
        });
    }
}

fn resolve_bg_cwd(
    window: &tauri::WebviewWindow,
    project_root: &tauri::State<'_, ProjectRootState>,
    cwd: Option<String>,
) -> Result<std::path::PathBuf, String> {
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
pub fn shell_bg_spawn(
    window: tauri::WebviewWindow,
    project_root: tauri::State<'_, ProjectRootState>,
    state: tauri::State<'_, BackgroundState>,
    command: String,
    cwd: Option<String>,
) -> Result<u32, String> {
    let cwd_path = resolve_bg_cwd(&window, &project_root, cwd)?;
    let proc = background::spawn(command, cwd_path)?;
    let id = state
        .next_id
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    state
        .procs
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, (window.label().to_string(), proc));
    Ok(id)
}

#[tauri::command]
pub fn shell_bg_logs(
    state: tauri::State<'_, BackgroundState>,
    handle: u32,
    since_offset: Option<u64>,
) -> Result<background::BackgroundLogResponse, String> {
    let proc = state
        .procs
        .lock()
        .map_err(|e| e.to_string())?
        .get(&handle)
        .map(|(_, p)| p.clone())
        .ok_or_else(|| "no background handle".to_string())?;
    Ok(proc.read_logs(since_offset.unwrap_or(0)))
}

#[tauri::command]
pub fn shell_bg_kill(state: tauri::State<'_, BackgroundState>, handle: u32) -> Result<(), String> {
    if let Some((_, proc)) = state.procs.lock().map_err(|e| e.to_string())?.get(&handle) {
        proc.kill();
    }
    Ok(())
}

#[tauri::command]
pub fn shell_bg_list(
    state: tauri::State<'_, BackgroundState>,
) -> Result<Vec<background::BackgroundProcInfo>, String> {
    let map = state.procs.lock().map_err(|e| e.to_string())?;
    let mut out: Vec<_> = map.iter().map(|(id, (_, p))| p.info(*id)).collect();
    out.sort_by_key(|i| i.handle);
    Ok(out)
}
