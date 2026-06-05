use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::SystemTime;

use serde::Serialize;
use shared_child::SharedChild;

use super::ringbuffer::BoundedRingBuffer;

const RING_CAP: usize = 4 * 1024 * 1024;

pub struct BackgroundProc {
    pub command: String,
    pub cwd: String,
    pub started_at_ms: u64,
    pub child: Arc<SharedChild>,
    pub buffer: Mutex<BoundedRingBuffer>,
    pub exited: AtomicBool,
    pub exit_code: AtomicI32,
    pub exit_unknown: AtomicBool,
}

#[derive(Serialize)]
pub struct BackgroundLogResponse {
    pub bytes: String,
    pub next_offset: u64,
    pub dropped: u64,
    pub exited: bool,
    pub exit_code: Option<i32>,
}

#[derive(Serialize)]
pub struct BackgroundProcInfo {
    pub handle: u32,
    pub command: String,
    pub cwd: String,
    pub started_at_ms: u64,
    pub exited: bool,
    pub exit_code: Option<i32>,
}

impl BackgroundProc {
    pub fn read_logs(&self, since: u64) -> BackgroundLogResponse {
        let (bytes, next_offset, dropped) = self
            .buffer
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .read_from(since);
        let exited = self.exited.load(Ordering::Acquire);
        let exit_code = if exited && !self.exit_unknown.load(Ordering::Acquire) {
            Some(self.exit_code.load(Ordering::Acquire))
        } else {
            None
        };
        BackgroundLogResponse {
            bytes: String::from_utf8_lossy(&bytes).into_owned(),
            next_offset,
            dropped,
            exited,
            exit_code,
        }
    }

    pub fn kill(&self) {
        let _ = self.child.kill();
    }

    pub fn info(&self, handle: u32) -> BackgroundProcInfo {
        let exited = self.exited.load(Ordering::Acquire);
        let exit_code = if exited && !self.exit_unknown.load(Ordering::Acquire) {
            Some(self.exit_code.load(Ordering::Acquire))
        } else {
            None
        };
        BackgroundProcInfo {
            handle,
            command: self.command.clone(),
            cwd: self.cwd.clone(),
            started_at_ms: self.started_at_ms,
            exited,
            exit_code,
        }
    }
}

impl Drop for BackgroundProc {
    fn drop(&mut self) {
        self.kill();
    }
}

fn build_command(command: &str) -> Command {
    #[cfg(not(windows))]
    {
        let mut cmd = Command::new("/bin/sh");
        cmd.arg("-c").arg(command);
        cmd
    }
    #[cfg(windows)]
    {
        let mut cmd = Command::new("cmd");
        cmd.arg("/C").arg(command);
        cmd
    }
}

pub fn spawn(command: String, cwd: PathBuf) -> Result<Arc<BackgroundProc>, String> {
    let trimmed = command.trim().to_string();
    if trimmed.is_empty() {
        return Err("empty command".into());
    }
    if !cwd.is_dir() {
        return Err(format!("cwd is not a directory: {}", cwd.display()));
    }

    let mut cmd = build_command(&trimmed);
    cmd.current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let shared = Arc::new(SharedChild::spawn(&mut cmd).map_err(|e| e.to_string())?);
    let stdout_pipe = shared.take_stdout().ok_or_else(|| {
        let _ = shared.kill();
        "no stdout pipe".to_string()
    })?;
    let stderr_pipe = shared.take_stderr().ok_or_else(|| {
        let _ = shared.kill();
        "no stderr pipe".to_string()
    })?;

    let started_at_ms = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let proc = Arc::new(BackgroundProc {
        command: trimmed,
        cwd: cwd.to_string_lossy().into_owned(),
        started_at_ms,
        child: shared,
        buffer: Mutex::new(BoundedRingBuffer::new(RING_CAP)),
        exited: AtomicBool::new(false),
        exit_code: AtomicI32::new(0),
        exit_unknown: AtomicBool::new(false),
    });

    let pipes: [Box<dyn Read + Send>; 2] = [Box::new(stdout_pipe), Box::new(stderr_pipe)];
    for pipe in pipes {
        let proc_ref = proc.clone();
        let mut pipe = pipe;
        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match pipe.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => proc_ref
                        .buffer
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .push(&buf[..n]),
                    Err(_) => break,
                }
            }
        });
    }
    {
        let proc_ref = proc.clone();
        let child_for_wait = proc.child.clone();
        thread::spawn(move || {
            match child_for_wait.wait() {
                Ok(status) => match status.code() {
                    Some(code) => proc_ref.exit_code.store(code, Ordering::Release),
                    None => proc_ref.exit_unknown.store(true, Ordering::Release),
                },
                Err(_) => proc_ref.exit_unknown.store(true, Ordering::Release),
            }
            proc_ref.exited.store(true, Ordering::Release);
        });
    }

    Ok(proc)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::time::Duration;

    fn wait_until_exited(proc: &BackgroundProc) {
        for _ in 0..100 {
            if proc.exited.load(Ordering::Acquire) {
                return;
            }
            thread::sleep(Duration::from_millis(20));
        }
        panic!("process did not exit in time");
    }

    #[test]
    fn spawn_rejects_empty_command() {
        assert!(spawn("   ".into(), std::env::temp_dir()).is_err());
    }

    #[test]
    fn spawn_captures_output_and_exit_code() {
        let proc = spawn("printf 'hello\\n'".into(), std::env::temp_dir()).unwrap();
        wait_until_exited(&proc);
        thread::sleep(Duration::from_millis(50));
        let logs = proc.read_logs(0);
        assert!(logs.bytes.contains("hello"));
        assert!(logs.exited);
        assert_eq!(logs.exit_code, Some(0));
    }

    #[test]
    fn spawn_reports_nonzero_exit() {
        let proc = spawn("exit 7".into(), std::env::temp_dir()).unwrap();
        wait_until_exited(&proc);
        assert_eq!(proc.read_logs(0).exit_code, Some(7));
    }

    #[test]
    fn kill_terminates_long_running_process() {
        let proc = spawn("sleep 30".into(), std::env::temp_dir()).unwrap();
        proc.kill();
        wait_until_exited(&proc);
        assert!(proc.exited.load(Ordering::Acquire));
    }
}
