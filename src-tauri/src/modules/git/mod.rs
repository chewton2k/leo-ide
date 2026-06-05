use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

use crate::modules::fs::ProjectRootState;

/// Validate that a repo_path is within (or equal to) the project root for git commands.
pub fn validate_repo_path(
    repo_path: &str,
    window_label: &str,
    state: &tauri::State<'_, ProjectRootState>,
) -> Result<PathBuf, String> {
    let map = state.blocking_read();
    let root = map
        .get(window_label)
        .and_then(|opt| opt.as_ref())
        .ok_or_else(|| "No project is open".to_string())?;
    let canonical = fs::canonicalize(repo_path).map_err(|e| format!("Invalid repo path: {}", e))?;
    if !canonical.starts_with(root) {
        return Err("Access denied: repo path is outside the project directory".to_string());
    }
    Ok(canonical)
}

/// Validate a relative file path used in git commands.
/// Rejects absolute paths, traversal sequences, and NUL bytes.
pub fn validate_git_file_path(file_path: &str) -> Result<(), String> {
    if file_path.is_empty() {
        return Err("Invalid file path: path cannot be empty".to_string());
    }
    if file_path.contains('\0') {
        return Err("Invalid file path: null bytes not allowed".to_string());
    }
    if file_path.starts_with('-') {
        return Err("Invalid file path: cannot start with '-' (flag injection)".to_string());
    }

    let path = Path::new(file_path);
    for component in path.components() {
        match component {
            Component::ParentDir => {
                return Err("Invalid file path: traversal not allowed".to_string());
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err("Invalid file path: absolute paths not allowed".to_string());
            }
            Component::Normal(name) if name.eq_ignore_ascii_case(".git") => {
                return Err("Invalid file path: .git paths are not allowed".to_string());
            }
            _ => {}
        }
    }
    Ok(())
}

/// Validate a git ref name per git-check-ref-format(1).
/// Rejects names that could be misinterpreted as flags or contain illegal characters.
pub fn validate_git_ref_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Invalid ref name: cannot be empty".to_string());
    }
    if name.starts_with('-') {
        return Err("Invalid ref name: cannot start with '-'".to_string());
    }
    if name.starts_with('.') {
        return Err("Invalid ref name: cannot start with '.'".to_string());
    }
    if name.ends_with('/') || name.starts_with('/') {
        return Err("Invalid ref name: cannot start or end with '/'".to_string());
    }
    if name.ends_with(".lock") {
        return Err("Invalid ref name: cannot end with '.lock'".to_string());
    }
    if name == "@" {
        return Err("Invalid ref name: '@' alone is not allowed".to_string());
    }
    if name.contains("..") || name.contains("@{") || name.contains("//") || name.contains("/.") {
        return Err("Invalid ref name: contains forbidden sequence".to_string());
    }
    for byte in name.bytes() {
        match byte {
            0..=0x1F | 0x7F => {
                return Err("Invalid ref name: control characters not allowed".to_string())
            }
            b' ' | b'\\' | b':' | b'?' | b'*' | b'[' | b'~' | b'^' => {
                return Err(format!(
                    "Invalid ref name: character '{}' not allowed",
                    byte as char
                ));
            }
            _ => {}
        }
    }
    Ok(())
}

// ── Serializable types ───────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct DiffLine {
    pub kind: String,
    pub old_num: Option<u32>,
    pub new_num: Option<u32>,
    pub text: String,
}

#[derive(Serialize, Clone)]
pub struct DiffRange {
    pub kind: String,
    pub start: u32,
    pub end: u32,
}

#[derive(Serialize, Clone)]
pub struct AheadBehind {
    pub ahead: u32,
    pub behind: u32,
    pub upstream: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct GitLogCommit {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub date: String,
    pub message: String,
}

#[derive(Serialize, Clone)]
pub struct GitGraphRow {
    pub graph: String,
    pub commit: Option<GitLogCommit>,
}

#[derive(Serialize, Clone)]
pub struct GitCommitGraphEntry {
    pub sha: String,
    pub short_sha: String,
    pub author: String,
    pub author_email: String,
    pub timestamp_secs: i64,
    pub parents: Vec<String>,
    pub subject: String,
    /// Decoration refs (branch heads, tags, HEAD) pointing at this commit.
    pub refs: Vec<String>,
    pub files_changed: u32,
    pub insertions: u32,
    pub deletions: u32,
}

#[derive(Serialize, Clone)]
pub struct GitCommitFileChange {
    pub path: String,
    pub original_path: Option<String>,
    pub status: String,
    pub status_label: String,
    pub added: u32,
    pub removed: u32,
    pub is_binary: bool,
}

#[derive(Serialize, Clone)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
}

// ── Internal helpers ─────────────────────────────────────────────

fn parse_unified_diff(diff: &str) -> Vec<DiffLine> {
    let mut lines = Vec::new();
    let mut old_line: u32 = 0;
    let mut new_line: u32 = 0;
    let mut in_hunk = false;

    for raw in diff.lines() {
        if raw.starts_with("@@") {
            in_hunk = true;
            if let Some(rest) = raw.strip_prefix("@@ -") {
                let parts: Vec<&str> = rest.splitn(2, '+').collect();
                if parts.len() == 2 {
                    old_line = parts[0]
                        .split(',')
                        .next()
                        .unwrap_or("1")
                        .trim()
                        .parse()
                        .unwrap_or(1);
                    new_line = parts[1]
                        .split([',', ' '])
                        .next()
                        .unwrap_or("1")
                        .parse()
                        .unwrap_or(1);
                }
            }
            lines.push(DiffLine {
                kind: "ctx".to_string(),
                old_num: None,
                new_num: None,
                text: raw.to_string(),
            });
        } else if !in_hunk {
            continue;
        } else if let Some(text) = raw.strip_prefix('+') {
            lines.push(DiffLine {
                kind: "add".to_string(),
                old_num: None,
                new_num: Some(new_line),
                text: text.to_string(),
            });
            new_line += 1;
        } else if let Some(text) = raw.strip_prefix('-') {
            lines.push(DiffLine {
                kind: "del".to_string(),
                old_num: Some(old_line),
                new_num: None,
                text: text.to_string(),
            });
            old_line += 1;
        } else {
            let text = raw.strip_prefix(' ').unwrap_or(raw);
            lines.push(DiffLine {
                kind: "ctx".to_string(),
                old_num: Some(old_line),
                new_num: Some(new_line),
                text: text.to_string(),
            });
            old_line += 1;
            new_line += 1;
        }
    }
    lines
}

fn parse_hunk_range(s: &str) -> (u32, u32) {
    let parts: Vec<&str> = s.split(',').collect();
    let start: u32 = parts[0].parse().unwrap_or(0);
    let count: u32 = if parts.len() > 1 {
        parts[1].parse().unwrap_or(1)
    } else {
        1
    };
    (start, count)
}

// ── Tauri commands ───────────────────────────────────────────────

/// One row from `git status --porcelain -z` output. The full stdout is
/// a sequence of NUL-separated entries; rename ('R') and copy ('C')
/// entries are followed by an additional entry containing the source
/// path. Parsing as raw bytes (not `String::from_utf8_lossy` over the
/// whole buffer) preserves non-UTF-8 path bytes per-entry rather than
/// smearing replacement characters across the whole buffer.
pub(crate) struct PorcelainEntry {
    pub index_status: u8,
    pub wt_status: u8,
    pub file: String,
    /// Source path for renames/copies. `None` for everything else.
    #[allow(dead_code)] // present for future consumers; not used yet
    pub orig: Option<String>,
}

/// Parse byte output from `git status --porcelain -z`.
///
/// The `-z` flag produces NUL-separated entries with no quoting, so we
/// can treat the buffer as `&[u8]` and only convert per-entry. Each
/// entry has the layout `XY <path>` where X is the index status, Y is
/// the working-tree status, and one space follows. Rename and copy
/// entries are followed by an extra NUL-separated entry containing the
/// source path.
pub(crate) fn parse_status_porcelain_z(stdout: &[u8]) -> Vec<PorcelainEntry> {
    let entries: Vec<&[u8]> = stdout.split(|&b| b == 0).collect();
    let mut result = Vec::new();
    let mut i = 0;
    while i < entries.len() {
        let entry = entries[i];
        if entry.len() < 4 {
            i += 1;
            continue;
        }
        let index_status = entry[0];
        let wt_status = entry[1];
        // entry[2] is a space separator; the path is everything after.
        let file_bytes = &entry[3..];
        let file = String::from_utf8_lossy(file_bytes).into_owned();

        let orig = if (index_status == b'R' || index_status == b'C')
            && i + 1 < entries.len()
            && !entries[i + 1].is_empty()
        {
            i += 1;
            Some(String::from_utf8_lossy(entries[i]).into_owned())
        } else {
            None
        };

        result.push(PorcelainEntry {
            index_status,
            wt_status,
            file,
            orig,
        });
        i += 1;
    }
    result
}

#[tauri::command]
pub fn get_git_status(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectRootState>,
    path: String,
) -> Result<HashMap<String, String>, String> {
    validate_repo_path(&path, window.label(), &state)?;
    let output = Command::new("git")
        .args(["status", "--porcelain", "-uall", "-z"])
        .current_dir(&path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Ok(HashMap::new());
    }

    let mut result = HashMap::new();
    for entry in parse_status_porcelain_z(&output.stdout) {
        let abs_path = PathBuf::from(&path).join(&entry.file);
        let abs_str = abs_path.to_string_lossy().to_string();

        let status = match (entry.index_status, entry.wt_status) {
            (b'?', b'?') => "U",
            (b'U', b'U')
            | (b'A', b'A')
            | (b'D', b'D')
            | (b'A', b'U')
            | (b'U', b'A')
            | (b'D', b'U')
            | (b'U', b'D') => "C",
            (b'A', _) => "A",
            (b'R', _) => "A",
            (b'M', b' ') | (b'M', b'\0') => "S",
            (b'D', b' ') | (b'D', b'\0') => "S",
            (_, b'D') => "D",
            (_, b'M') => "M",
            _ => "M",
        };

        result.insert(abs_str, status.to_string());
    }

    Ok(result)
}

#[tauri::command]
pub fn get_git_remote_status(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectRootState>,
    path: String,
) -> Result<HashMap<String, String>, String> {
    validate_repo_path(&path, window.label(), &state)?;

    let upstream_check = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "@{u}"])
        .current_dir(&path)
        .output()
        .map_err(|e| e.to_string())?;

    if !upstream_check.status.success() {
        return Ok(HashMap::new());
    }

    let output = Command::new("git")
        .args(["diff", "--name-status", "HEAD...@{u}"])
        .current_dir(&path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Ok(HashMap::new());
    }

    // Parse line-by-line over the raw byte buffer rather than running
    // `String::from_utf8_lossy` over the whole output up-front. This
    // confines any UTF-8 replacement characters to a single line if a
    // path happens to contain non-UTF-8 bytes, instead of smearing
    // them across the buffer.
    let mut result = HashMap::new();

    for line_bytes in output.stdout.split(|&b| b == b'\n') {
        if line_bytes.is_empty() {
            continue;
        }
        let line_cow = String::from_utf8_lossy(line_bytes);
        let line = line_cow.trim();
        if line.is_empty() {
            continue;
        }

        let mut parts = line.splitn(2, '\t');
        let status_code = match parts.next() {
            Some(s) => s.trim(),
            None => continue,
        };
        let file_path = match parts.next() {
            Some(p) => p.trim(),
            None => continue,
        };

        let code = if status_code.starts_with('R') {
            "A"
        } else if status_code == "M" {
            "M"
        } else if status_code == "A" {
            "A"
        } else if status_code == "D" {
            "D"
        } else {
            "M"
        };

        let actual_path = if status_code.starts_with('R') {
            file_path.split('\t').next_back().unwrap_or(file_path)
        } else {
            file_path
        };

        let abs_path = PathBuf::from(&path).join(actual_path);
        let abs_str = abs_path.to_string_lossy().to_string();
        result.insert(abs_str, code.to_string());
    }

    Ok(result)
}

#[tauri::command]
pub fn get_git_ignored(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectRootState>,
    path: String,
) -> Result<Vec<String>, String> {
    validate_repo_path(&path, window.label(), &state)?;
    let output = Command::new("git")
        .args([
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
            "--directory",
        ])
        .current_dir(&path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Ok(Vec::new());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let root = PathBuf::from(&path);
    let result: Vec<String> = stdout
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| {
            let clean = l.trim_end_matches('/');
            root.join(clean).to_string_lossy().to_string()
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub fn get_git_branch(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectRootState>,
    path: String,
) -> Result<Option<String>, String> {
    let map = state.blocking_read();
    let root = map
        .get(window.label())
        .and_then(|opt| opt.as_ref())
        .ok_or_else(|| "No project is open".to_string())?;
    let canonical = fs::canonicalize(&path).map_err(|e| format!("Invalid path: {}", e))?;
    if !canonical.starts_with(root) {
        return Err("Access denied: path is outside the project directory".to_string());
    }

    let mut dir = canonical;
    loop {
        let git_dir = dir.join(".git");
        if git_dir.exists() {
            let head_file = git_dir.join("HEAD");
            if let Ok(content) = fs::read_to_string(&head_file) {
                let content = content.trim();
                if let Some(branch) = content.strip_prefix("ref: refs/heads/") {
                    return Ok(Some(branch.to_string()));
                }
                return Ok(Some(content[..7.min(content.len())].to_string()));
            }
            return Ok(None);
        }
        if dir == *root {
            return Ok(None);
        }
        if !dir.pop() {
            return Ok(None);
        }
    }
}

#[tauri::command]
pub fn git_diff(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectRootState>,
    repo_path: String,
    file_path: String,
    staged: bool,
    is_untracked: Option<bool>,
) -> Result<Vec<DiffLine>, String> {
    validate_repo_path(&repo_path, window.label(), &state)?;
    validate_git_file_path(&file_path)?;

    let untracked = match is_untracked {
        Some(v) => v,
        None => {
            let status_out = Command::new("git")
                .args(["status", "--porcelain", "--", &file_path])
                .current_dir(&repo_path)
                .output()
                .map_err(|e| e.to_string())?;
            let status_str = String::from_utf8_lossy(&status_out.stdout);
            status_str.lines().any(|l| l.starts_with("??"))
        }
    };

    let output = if untracked {
        let abs = PathBuf::from(&repo_path).join(&file_path);
        Command::new("git")
            .args(["diff", "--no-index", "/dev/null", &abs.to_string_lossy()])
            .current_dir(&repo_path)
            .output()
            .map_err(|e| e.to_string())?
    } else if staged {
        Command::new("git")
            .args(["diff", "--cached", "--", &file_path])
            .current_dir(&repo_path)
            .output()
            .map_err(|e| e.to_string())?
    } else {
        Command::new("git")
            .args(["diff", "--", &file_path])
            .current_dir(&repo_path)
            .output()
            .map_err(|e| e.to_string())?
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_unified_diff(&stdout))
}

#[tauri::command]
pub fn git_stage(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectRootState>,
    repo_path: String,
    paths: Vec<String>,
) -> Result<(), String> {
    validate_repo_path(&repo_path, window.label(), &state)?;
    for p in &paths {
        validate_git_file_path(p)?;
    }
    let mut args = vec!["add".to_string(), "--".to_string()];
    args.extend(paths);
    let output = Command::new("git")
        .args(&args)
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn git_unstage(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectRootState>,
    repo_path: String,
    paths: Vec<String>,
) -> Result<(), String> {
    validate_repo_path(&repo_path, window.label(), &state)?;
    for p in &paths {
        validate_git_file_path(p)?;
    }
    let mut args = vec![
        "restore".to_string(),
        "--staged".to_string(),
        "--".to_string(),
    ];
    args.extend(paths);
    let output = Command::new("git")
        .args(&args)
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn git_discard(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectRootState>,
    repo_path: String,
    paths: Vec<String>,
) -> Result<(), String> {
    validate_repo_path(&repo_path, window.label(), &state)?;
    for p in &paths {
        validate_git_file_path(p)?;
    }

    let mut status_args = vec![
        "status".to_string(),
        "--porcelain".to_string(),
        "-z".to_string(),
        "-uall".to_string(),
        "--".to_string(),
    ];
    status_args.extend(paths.iter().cloned());
    let status_output = Command::new("git")
        .args(&status_args)
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;
    let mut untracked: Vec<String> = Vec::new();
    let mut tracked: Vec<String> = Vec::new();

    let path_set: std::collections::HashSet<&str> = paths.iter().map(|s| s.as_str()).collect();

    for entry in parse_status_porcelain_z(&status_output.stdout) {
        if path_set.contains(entry.file.as_str()) {
            if entry.index_status == b'?' && entry.wt_status == b'?' {
                untracked.push(entry.file);
            } else {
                tracked.push(entry.file);
            }
        }
    }

    if !tracked.is_empty() {
        let mut args = vec!["checkout".to_string(), "--".to_string()];
        args.extend(tracked);
        let output = Command::new("git")
            .args(&args)
            .current_dir(&repo_path)
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
    }

    if !untracked.is_empty() {
        let map = state.blocking_read();
        let root = map
            .get(window.label())
            .and_then(|opt| opt.as_ref())
            .ok_or_else(|| "No project is open".to_string())?;
        for file in &untracked {
            let full_path = PathBuf::from(&repo_path).join(file);
            let canonical = if full_path.exists() {
                fs::canonicalize(&full_path).map_err(|e| format!("Invalid path: {}", e))?
            } else {
                continue;
            };
            if !canonical.starts_with(root) {
                return Err(format!(
                    "Access denied: '{}' is outside the project directory",
                    file
                ));
            }
            trash::delete(&canonical)
                .map_err(|e| format!("Failed to discard '{}': {}", file, e))?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn git_commit(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectRootState>,
    repo_path: String,
    message: String,
) -> Result<String, String> {
    validate_repo_path(&repo_path, window.label(), &state)?;
    let output = Command::new("git")
        .args(["commit", "-m", &message])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let hash = stdout
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("unknown")
        .trim_end_matches(']')
        .to_string();
    Ok(hash)
}

#[tauri::command]
pub fn git_push(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectRootState>,
    repo_path: String,
) -> Result<String, String> {
    validate_repo_path(&repo_path, window.label(), &state)?;
    let output = Command::new("git")
        .args(["push"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if stderr.contains("no upstream") || stderr.contains("has no upstream branch") {
            let branch_output = Command::new("git")
                .args(["rev-parse", "--abbrev-ref", "HEAD"])
                .current_dir(&repo_path)
                .output()
                .map_err(|e| e.to_string())?;
            let branch_name = String::from_utf8_lossy(&branch_output.stdout)
                .trim()
                .to_string();
            if branch_name.is_empty() {
                return Err(stderr);
            }
            let retry = Command::new("git")
                .args(["push", "--set-upstream", "origin", &branch_name])
                .current_dir(&repo_path)
                .output()
                .map_err(|e| e.to_string())?;
            if !retry.status.success() {
                return Err(String::from_utf8_lossy(&retry.stderr).to_string());
            }
            return Ok(String::from_utf8_lossy(&retry.stderr).to_string());
        }
        return Err(stderr);
    }
    Ok(String::from_utf8_lossy(&output.stderr).to_string())
}

#[tauri::command]
pub fn git_fetch(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectRootState>,
    repo_path: String,
) -> Result<String, String> {
    validate_repo_path(&repo_path, window.label(), &state)?;
    let output = Command::new("git")
        .args(["fetch"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stderr).to_string())
}

#[tauri::command]
pub fn git_pull(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectRootState>,
    repo_path: String,
) -> Result<String, String> {
    validate_repo_path(&repo_path, window.label(), &state)?;
    let output = Command::new("git")
        .args(["pull"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    Ok(format!("{}{}", stdout, stderr))
}

#[tauri::command]
pub fn git_pull_rebase(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectRootState>,
    repo_path: String,
) -> Result<String, String> {
    validate_repo_path(&repo_path, window.label(), &state)?;
    let output = Command::new("git")
        .args(["pull", "--rebase"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    Ok(format!("{}{}", stdout, stderr))
}

#[tauri::command]
pub fn git_delete_branch(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectRootState>,
    repo_path: String,
    branch: String,
    force: bool,
) -> Result<String, String> {
    validate_repo_path(&repo_path, window.label(), &state)?;
    validate_git_ref_name(&branch)?;
    let head_output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;
    let current_branch = String::from_utf8_lossy(&head_output.stdout)
        .trim()
        .to_string();
    if branch == current_branch {
        return Err("Cannot delete the currently checked-out branch".to_string());
    }
    let flag = if force { "-D" } else { "-d" };
    let output = Command::new("git")
        .args(["branch", flag, &branch])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub fn git_ahead_behind(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectRootState>,
    repo_path: String,
) -> Result<AheadBehind, String> {
    validate_repo_path(&repo_path, window.label(), &state)?;
    let upstream_out = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !upstream_out.status.success() {
        return Ok(AheadBehind {
            ahead: 0,
            behind: 0,
            upstream: None,
        });
    }

    let upstream = String::from_utf8_lossy(&upstream_out.stdout)
        .trim()
        .to_string();

    let output = Command::new("git")
        .args(["rev-list", "--count", "--left-right", "HEAD...@{u}"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Ok(AheadBehind {
            ahead: 0,
            behind: 0,
            upstream: Some(upstream),
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parts: Vec<&str> = stdout.trim().split('\t').collect();
    let ahead = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);
    let behind = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);

    Ok(AheadBehind {
        ahead,
        behind,
        upstream: Some(upstream),
    })
}

#[tauri::command]
pub fn git_diff_line_ranges(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectRootState>,
    repo_path: String,
    file_path: String,
) -> Result<Vec<DiffRange>, String> {
    validate_repo_path(&repo_path, window.label(), &state)?;
    validate_git_file_path(&file_path)?;

    // Resolve the absolute path of the file to find its actual git root.
    // This handles sub-repos/submodules: git is invoked from the file's
    // parent directory so it auto-discovers the correct .git ancestor.
    let abs_file = PathBuf::from(&repo_path).join(&file_path);
    let work_dir = abs_file.parent().unwrap_or_else(|| Path::new(&repo_path));
    // Canonicalize and verify work_dir is still within the project root
    // to prevent symlink-based escapes.
    let work_dir = std::fs::canonicalize(work_dir).unwrap_or_else(|_| work_dir.to_path_buf());
    let canonical_repo =
        std::fs::canonicalize(&repo_path).unwrap_or_else(|_| PathBuf::from(&repo_path));
    if !work_dir.starts_with(&canonical_repo) {
        return Err("Access denied: file path resolves outside the project directory".to_string());
    }
    let file_name = abs_file
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| file_path.clone());

    let output = Command::new("git")
        .args(["diff", "-U0", "--", &file_name])
        .current_dir(&work_dir)
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut ranges = Vec::new();

    for line in stdout.lines() {
        if !line.starts_with("@@") {
            continue;
        }
        if let Some(rest) = line.strip_prefix("@@ -") {
            let parts: Vec<&str> = rest.splitn(2, '+').collect();
            if parts.len() != 2 {
                continue;
            }

            let old_part = parts[0].trim().trim_end_matches(',');
            let new_part = parts[1].split_whitespace().next().unwrap_or("0");

            let (_old_start, old_count) = parse_hunk_range(old_part);
            let (new_start, new_count) = parse_hunk_range(new_part);

            if old_count == 0 && new_count > 0 {
                ranges.push(DiffRange {
                    kind: "add".to_string(),
                    start: new_start,
                    end: new_start + new_count - 1,
                });
            } else if new_count == 0 && old_count > 0 {
                ranges.push(DiffRange {
                    kind: "del".to_string(),
                    start: new_start.max(1),
                    end: new_start.max(1),
                });
            } else {
                ranges.push(DiffRange {
                    kind: "mod".to_string(),
                    start: new_start,
                    end: new_start + new_count - 1,
                });
            }
        }
    }

    Ok(ranges)
}

#[tauri::command]
pub fn git_log(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectRootState>,
    repo_path: String,
    count: Option<u32>,
) -> Result<Vec<GitGraphRow>, String> {
    validate_repo_path(&repo_path, window.label(), &state)?;
    let limit = count.unwrap_or(50).min(500).to_string();
    let format = "%H\x09%h\x09%an\x09%ar\x09%s".to_string();
    let output = Command::new("git")
        .args([
            "log",
            "--graph",
            &format!("--format=format:{}", format),
            "-n",
            &limit,
        ])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Ok(Vec::new());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut rows = Vec::new();

    for line in stdout.lines() {
        if let Some(star_pos) = line.find('*') {
            let graph_prefix = &line[..star_pos];
            let after_star = &line[star_pos + 1..].trim_start();
            let commit = if !after_star.is_empty() {
                let parts: Vec<&str> = after_star.splitn(5, '\t').collect();
                if parts.len() >= 5 {
                    Some(GitLogCommit {
                        hash: parts[0].to_string(),
                        short_hash: parts[1].to_string(),
                        author: parts[2].to_string(),
                        date: parts[3].to_string(),
                        message: parts[4].to_string(),
                    })
                } else {
                    None
                }
            } else {
                None
            };
            let graph = format!("{}*", graph_prefix);
            rows.push(GitGraphRow { graph, commit });
        } else {
            rows.push(GitGraphRow {
                graph: line.to_string(),
                commit: None,
            });
        }
    }

    Ok(rows)
}

fn parse_commit_graph(stdout: &str) -> Vec<GitCommitGraphEntry> {
    let mut entries: Vec<GitCommitGraphEntry> = Vec::new();
    for line in stdout.lines() {
        if line.is_empty() {
            continue;
        }
        if line.contains('\x1f') {
            let f: Vec<&str> = line.splitn(8, '\x1f').collect();
            if f.len() < 8 {
                continue;
            }
            entries.push(GitCommitGraphEntry {
                sha: f[0].to_string(),
                short_sha: f[1].to_string(),
                author: f[2].to_string(),
                author_email: f[3].to_string(),
                timestamp_secs: f[4].parse().unwrap_or(0),
                parents: f[5].split_whitespace().map(|s| s.to_string()).collect(),
                refs: f[6]
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect(),
                subject: f[7].to_string(),
                files_changed: 0,
                insertions: 0,
                deletions: 0,
            });
        } else if line.contains("changed") {
            // `git log --shortstat` tail, e.g. " 5 files changed, 12 insertions(+), 3 deletions(-)"
            if let Some(last) = entries.last_mut() {
                let (files, ins, del) = parse_shortstat(line);
                last.files_changed = files;
                last.insertions = ins;
                last.deletions = del;
            }
        }
    }
    entries
}

/// Parse a `git --shortstat` summary line into (files_changed, insertions, deletions).
fn parse_shortstat(line: &str) -> (u32, u32, u32) {
    let trimmed = line.trim();
    if !(trimmed.contains("file changed") || trimmed.contains("files changed")) {
        return (0, 0, 0);
    }
    let (mut files, mut ins, mut del) = (0u32, 0u32, 0u32);
    for part in trimmed.split(',') {
        let part = part.trim();
        let n: u32 = part
            .split_ascii_whitespace()
            .next()
            .unwrap_or("0")
            .parse()
            .unwrap_or(0);
        if part.contains("file") {
            files = n;
        } else if part.contains("insertion") {
            ins = n;
        } else if part.contains("deletion") {
            del = n;
        }
    }
    (files, ins, del)
}

#[tauri::command]
pub fn git_commit_graph(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectRootState>,
    repo_path: String,
    count: Option<u32>,
) -> Result<Vec<GitCommitGraphEntry>, String> {
    validate_repo_path(&repo_path, window.label(), &state)?;
    let limit = count.unwrap_or(100).min(1000).to_string();
    let format = "%H\x1f%h\x1f%an\x1f%ae\x1f%at\x1f%P\x1f%D\x1f%s";
    let output = Command::new("git")
        .args([
            "log",
            "--topo-order",
            "--shortstat",
            &format!("--format=format:{}", format),
            "-n",
            &limit,
        ])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Ok(Vec::new());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_commit_graph(&stdout))
}

fn sha_is_safe(sha: &str) -> bool {
    !sha.is_empty() && sha.len() <= 64 && sha.chars().all(|c| c.is_ascii_hexdigit())
}

fn status_label(code: char) -> String {
    match code {
        'A' => "Added",
        'M' => "Modified",
        'D' => "Deleted",
        'R' => "Renamed",
        'C' => "Copied",
        'T' => "Type changed",
        _ => "Changed",
    }
    .to_string()
}

/// Parse `git diff-tree --name-status` output into (status, path, original_path).
fn parse_name_status(stdout: &str) -> Vec<(char, String, Option<String>)> {
    let mut out = Vec::new();
    for line in stdout.lines() {
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split('\t');
        let code = parts.next().unwrap_or("");
        let status = code.chars().next().unwrap_or('?').to_ascii_uppercase();
        if status == 'R' || status == 'C' {
            let orig = parts.next().unwrap_or("").to_string();
            let new = parts.next().unwrap_or("").to_string();
            if new.is_empty() {
                continue;
            }
            out.push((status, new, Some(orig)));
        } else {
            let path = parts.next().unwrap_or("").to_string();
            if path.is_empty() {
                continue;
            }
            out.push((status, path, None));
        }
    }
    out
}

/// Parse `git diff-tree --numstat` output into (added, removed, is_binary), in file order.
fn parse_numstat(stdout: &str) -> Vec<(u32, u32, bool)> {
    let mut out = Vec::new();
    for line in stdout.lines() {
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split('\t');
        let a = parts.next().unwrap_or("0");
        let r = parts.next().unwrap_or("0");
        if a == "-" || r == "-" {
            out.push((0, 0, true));
        } else {
            out.push((a.parse().unwrap_or(0), r.parse().unwrap_or(0), false));
        }
    }
    out
}

/// Zip ordered name-status + numstat (diff-tree emits files in the same order
/// for both) into per-file change records.
fn merge_commit_files(
    name_status: Vec<(char, String, Option<String>)>,
    numstat: Vec<(u32, u32, bool)>,
) -> Vec<GitCommitFileChange> {
    name_status
        .into_iter()
        .enumerate()
        .map(|(i, (status, path, original_path))| {
            let (added, removed, is_binary) = numstat.get(i).copied().unwrap_or((0, 0, false));
            GitCommitFileChange {
                path,
                original_path,
                status: status.to_string(),
                status_label: status_label(status),
                added,
                removed,
                is_binary,
            }
        })
        .collect()
}

#[tauri::command]
pub fn git_commit_files(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectRootState>,
    repo_path: String,
    sha: String,
) -> Result<Vec<GitCommitFileChange>, String> {
    validate_repo_path(&repo_path, window.label(), &state)?;
    if !sha_is_safe(&sha) {
        return Err("Invalid commit sha".to_string());
    }
    let name_status = Command::new("git")
        .args([
            "diff-tree",
            "--no-commit-id",
            "-r",
            "--root",
            "--name-status",
            &sha,
        ])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;
    if !name_status.status.success() {
        return Ok(Vec::new());
    }
    let numstat = Command::new("git")
        .args([
            "diff-tree",
            "--no-commit-id",
            "-r",
            "--root",
            "--numstat",
            &sha,
        ])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;
    let ns = parse_name_status(&String::from_utf8_lossy(&name_status.stdout));
    let nm = parse_numstat(&String::from_utf8_lossy(&numstat.stdout));
    Ok(merge_commit_files(ns, nm))
}

#[tauri::command]
pub fn git_remote_url(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectRootState>,
    repo_path: String,
) -> Result<Option<String>, String> {
    validate_repo_path(&repo_path, window.label(), &state)?;
    let out = Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Ok(None);
    }
    let url = String::from_utf8_lossy(&out.stdout).trim().to_string();
    Ok(if url.is_empty() { None } else { Some(url) })
}

#[tauri::command]
pub fn git_commit_file_diff(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectRootState>,
    repo_path: String,
    sha: String,
    file_path: String,
) -> Result<Vec<DiffLine>, String> {
    validate_repo_path(&repo_path, window.label(), &state)?;
    validate_git_file_path(&file_path)?;
    if !sha_is_safe(&sha) {
        return Err("Invalid commit sha".to_string());
    }
    let output = Command::new("git")
        .args([
            "show",
            "--no-color",
            "--first-parent",
            "--format=",
            &sha,
            "--",
            &file_path,
        ])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Ok(Vec::new());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_unified_diff(&stdout))
}

#[tauri::command]
pub fn git_list_branches(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectRootState>,
    repo_path: String,
) -> Result<Vec<BranchInfo>, String> {
    validate_repo_path(&repo_path, window.label(), &state)?;
    let output = Command::new("git")
        .args(["branch", "-a", "--no-color"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut branches = Vec::new();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.contains("->") {
            continue;
        }

        let is_current = trimmed.starts_with('*');
        let name = trimmed
            .trim_start_matches("* ")
            .trim_start_matches("remotes/")
            .to_string();
        let is_remote = line.contains("remotes/");

        branches.push(BranchInfo {
            name,
            is_current,
            is_remote,
        });
    }

    branches.sort_by(|a, b| {
        b.is_current
            .cmp(&a.is_current)
            .then(a.is_remote.cmp(&b.is_remote))
            .then(a.name.cmp(&b.name))
    });

    Ok(branches)
}

#[tauri::command]
pub fn git_checkout_branch(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectRootState>,
    repo_path: String,
    branch: String,
    is_remote: bool,
) -> Result<String, String> {
    validate_repo_path(&repo_path, window.label(), &state)?;
    if is_remote {
        // For remote branches like "origin/feature", validate the local name portion
        let local_name = branch.split('/').skip(1).collect::<Vec<&str>>().join("/");
        if local_name.is_empty() {
            return Err("Invalid remote branch name".to_string());
        }
        validate_git_ref_name(&local_name)?;
    } else {
        validate_git_ref_name(&branch)?;
    }

    let output = if is_remote {
        Command::new("git")
            .args(["checkout", "--track", &format!("remotes/{}", branch)])
            .current_dir(&repo_path)
            .output()
            .map_err(|e| e.to_string())?
    } else {
        Command::new("git")
            .args(["checkout", &branch])
            .current_dir(&repo_path)
            .output()
            .map_err(|e| e.to_string())?
    };

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(String::from_utf8_lossy(&output.stderr).trim().to_string())
}

#[tauri::command]
pub fn git_resolve_conflict(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectRootState>,
    repo_path: String,
    file_path: String,
    content: String,
    stage: bool,
) -> Result<(), String> {
    let canonical_repo = validate_repo_path(&repo_path, window.label(), &state)?;
    validate_git_file_path(&file_path)?;

    let abs_path = canonical_repo.join(&file_path);

    if !abs_path.starts_with(&canonical_repo) {
        return Err("Access denied: file path is outside the repository".to_string());
    }

    fs::write(&abs_path, &content).map_err(|e| format!("Failed to write file: {}", e))?;

    if stage {
        let output = Command::new("git")
            .args(["add", "--", &file_path])
            .current_dir(&canonical_repo)
            .output()
            .map_err(|e| format!("Failed to run git add: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git add failed: {}", stderr));
        }
    }

    Ok(())
}

// ── Checkpoints (agent undo) ──

#[derive(Serialize, Clone)]
pub struct Checkpoint {
    pub id: String,
    pub message: String,
    pub timestamp: i64,
}

/// Create a checkpoint by committing all current changes to a hidden ref.
/// This allows "undo agent run" by restoring to this point.
#[tauri::command]
pub fn git_create_checkpoint(
    window: tauri::WebviewWindow,
    repo_path: String,
    message: String,
    state: tauri::State<'_, ProjectRootState>,
) -> Result<String, String> {
    let repo = validate_repo_path(&repo_path, window.label(), &state)?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let checkpoint_id = format!("leo-checkpoint-{}", timestamp);

    // Stage all changes (including untracked)
    let add_out = Command::new("git")
        .args(["add", "-A"])
        .current_dir(&repo)
        .output()
        .map_err(|e| format!("git add: {}", e))?;
    if !add_out.status.success() {
        // Nothing to stage is fine — we'll still create the tree
    }

    // Create a tree object from the current index
    let tree_out = Command::new("git")
        .args(["write-tree"])
        .current_dir(&repo)
        .output()
        .map_err(|e| format!("git write-tree: {}", e))?;
    if !tree_out.status.success() {
        return Err("Failed to write tree for checkpoint".into());
    }
    let tree_sha = String::from_utf8_lossy(&tree_out.stdout).trim().to_string();

    // Get current HEAD for parent
    let head_out = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&repo)
        .output()
        .map_err(|e| format!("git rev-parse: {}", e))?;
    let parent_arg = if head_out.status.success() {
        let head = String::from_utf8_lossy(&head_out.stdout).trim().to_string();
        vec!["-p".to_string(), head]
    } else {
        vec![] // Initial commit — no parent
    };

    // Create commit object
    let mut commit_args = vec!["commit-tree".to_string(), tree_sha];
    commit_args.extend(parent_arg);
    commit_args.extend(["-m".to_string(), message.clone()]);

    let commit_out = Command::new("git")
        .args(&commit_args)
        .current_dir(&repo)
        .output()
        .map_err(|e| format!("git commit-tree: {}", e))?;
    if !commit_out.status.success() {
        return Err("Failed to create checkpoint commit".into());
    }
    let commit_sha = String::from_utf8_lossy(&commit_out.stdout)
        .trim()
        .to_string();

    // Store as a hidden ref
    let ref_name = format!("refs/leo/checkpoints/{}", checkpoint_id);
    let update_out = Command::new("git")
        .args(["update-ref", &ref_name, &commit_sha])
        .current_dir(&repo)
        .output()
        .map_err(|e| format!("git update-ref: {}", e))?;
    if !update_out.status.success() {
        return Err("Failed to store checkpoint ref".into());
    }

    // Reset index back to HEAD (don't leave staged changes from our add -A)
    let _ = Command::new("git")
        .args(["reset", "HEAD"])
        .current_dir(&repo)
        .output();

    Ok(checkpoint_id)
}

/// Restore a checkpoint by checking out its tree.
#[tauri::command]
pub fn git_restore_checkpoint(
    window: tauri::WebviewWindow,
    repo_path: String,
    checkpoint_id: String,
    state: tauri::State<'_, ProjectRootState>,
) -> Result<(), String> {
    let repo = validate_repo_path(&repo_path, window.label(), &state)?;

    // Validate checkpoint_id format
    if !checkpoint_id.starts_with("leo-checkpoint-") {
        return Err("Invalid checkpoint ID".into());
    }

    let ref_name = format!("refs/leo/checkpoints/{}", checkpoint_id);

    // Verify the ref exists
    let verify_out = Command::new("git")
        .args(["rev-parse", "--verify", &ref_name])
        .current_dir(&repo)
        .output()
        .map_err(|e| format!("git rev-parse: {}", e))?;
    if !verify_out.status.success() {
        return Err(format!("Checkpoint '{}' not found", checkpoint_id));
    }
    let commit_sha = String::from_utf8_lossy(&verify_out.stdout)
        .trim()
        .to_string();

    // Checkout the tree from that commit (overwrites working directory)
    let checkout_out = Command::new("git")
        .args(["checkout", &commit_sha, "--", "."])
        .current_dir(&repo)
        .output()
        .map_err(|e| format!("git checkout: {}", e))?;
    if !checkout_out.status.success() {
        let stderr = String::from_utf8_lossy(&checkout_out.stderr);
        return Err(format!("Failed to restore checkpoint: {}", stderr));
    }

    Ok(())
}

/// List all checkpoints for a repo.
#[tauri::command]
pub fn git_list_checkpoints(
    window: tauri::WebviewWindow,
    repo_path: String,
    state: tauri::State<'_, ProjectRootState>,
) -> Result<Vec<Checkpoint>, String> {
    let repo = validate_repo_path(&repo_path, window.label(), &state)?;

    // List refs under refs/leo/checkpoints/
    let out = Command::new("git")
        .args([
            "for-each-ref",
            "--format=%(refname:short) %(subject) %(creatordate:unix)",
            "refs/leo/checkpoints/",
        ])
        .current_dir(&repo)
        .output()
        .map_err(|e| format!("git for-each-ref: {}", e))?;

    if !out.status.success() {
        return Ok(vec![]);
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut checkpoints: Vec<Checkpoint> = Vec::new();

    for line in stdout.lines() {
        let parts: Vec<&str> = line.splitn(3, ' ').collect();
        if parts.len() < 2 {
            continue;
        }
        let ref_short = parts[0]; // e.g. "leo/checkpoints/leo-checkpoint-1234"
        let id = ref_short
            .rsplit('/')
            .next()
            .unwrap_or(ref_short)
            .to_string();
        let message = if parts.len() > 1 {
            parts[1..parts.len() - 1].join(" ")
        } else {
            String::new()
        };
        let timestamp = parts
            .last()
            .and_then(|t| t.parse::<i64>().ok())
            .unwrap_or(0);

        checkpoints.push(Checkpoint {
            id,
            message,
            timestamp,
        });
    }

    // Sort newest first
    checkpoints.sort_by_key(|c| std::cmp::Reverse(c.timestamp));
    Ok(checkpoints)
}

/// Find all git repositories within the project root (directories containing .git).
/// Returns paths relative to the project root. Searches up to 3 levels deep.
#[tauri::command]
pub fn find_git_repos(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectRootState>,
    path: String,
) -> Result<Vec<String>, String> {
    validate_repo_path(&path, window.label(), &state)?;
    let root = PathBuf::from(&path);
    let mut repos = Vec::new();
    // Check if root itself is a git repo
    if root.join(".git").exists() {
        repos.push(path.clone());
        return Ok(repos);
    }
    // Search subdirectories up to 3 levels
    fn scan(dir: &Path, depth: u32, repos: &mut Vec<String>) {
        if depth > 3 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_dir() {
                continue;
            }
            let name = p.file_name().unwrap_or_default().to_string_lossy();
            if name == "node_modules" || name == "target" || name == ".git" {
                continue;
            }
            if p.join(".git").exists() {
                repos.push(p.to_string_lossy().to_string());
            } else {
                scan(&p, depth + 1, repos);
            }
        }
    }
    scan(&root, 0, &mut repos);
    Ok(repos)
}

/// Clone a git repository. Does not require a project to be open.
/// Used by the "Clone Repo" welcome screen action.
#[tauri::command]
pub async fn git_clone(url: String, dest: String) -> Result<(), String> {
    let output = tokio::process::Command::new("git")
        .args(["clone", &url])
        .current_dir(&dest)
        .output()
        .await
        .map_err(|e| format!("Failed to run git clone: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git clone failed: {}", stderr));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_git_ref_name_rejects_bad_inputs() {
        let bad = vec![
            "", "-x", "..", "foo..bar", "foo bar", "\x01ctrl", "foo:bar", "foo?", "foo*", "foo[",
            "foo~", "foo^", "foo\\bar", ".lock", "foo.lock", "/foo", "foo/", "foo//bar",
            "foo/.bar", "@", "foo@{", "foo\0bar",
        ];
        for input in bad {
            assert!(
                validate_git_ref_name(input).is_err(),
                "Expected rejection for: {:?}",
                input
            );
        }
    }

    #[test]
    fn test_validate_git_ref_name_accepts_good_inputs() {
        let good = vec![
            "main",
            "feature/login",
            "release-1.0",
            "fix_bug",
            "dependabot/npm/foo-1.2.3",
        ];
        for input in good {
            assert!(
                validate_git_ref_name(input).is_ok(),
                "Expected acceptance for: {:?}",
                input
            );
        }
    }

    #[test]
    fn test_validate_git_file_path_rejects_leading_dash() {
        assert!(validate_git_file_path("--exec=evil").is_err());
        assert!(validate_git_file_path("-flag").is_err());
    }

    #[test]
    fn test_validate_git_file_path_rejects_traversal() {
        assert!(validate_git_file_path("../etc/passwd").is_err());
        assert!(validate_git_file_path("foo/../../bar").is_err());
    }

    #[test]
    fn test_validate_git_file_path_rejects_absolute() {
        assert!(validate_git_file_path("/etc/passwd").is_err());
    }

    #[test]
    fn test_validate_git_file_path_rejects_git_dir() {
        assert!(validate_git_file_path(".git/config").is_err());
    }

    #[test]
    fn test_validate_git_file_path_accepts_valid() {
        assert!(validate_git_file_path("src/main.rs").is_ok());
        assert!(validate_git_file_path("README.md").is_ok());
        assert!(validate_git_file_path("path/to/file.txt").is_ok());
    }

    // ── Byte-level porcelain-z parser tests (C6) ────────────────

    fn build_z(parts: &[&[u8]]) -> Vec<u8> {
        // Helper: join byte slices with NUL separators, ending with a
        // trailing NUL just like real `git status -z` output.
        let mut out = Vec::new();
        for (i, p) in parts.iter().enumerate() {
            out.extend_from_slice(p);
            if i + 1 < parts.len() {
                out.push(0);
            }
        }
        out.push(0);
        out
    }

    #[test]
    fn test_parse_porcelain_z_ascii_paths() {
        // Two simple modifications, one untracked file.
        let raw = build_z(&[b" M src/main.rs", b"M  Cargo.toml", b"?? notes.txt"]);
        let entries = parse_status_porcelain_z(&raw);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].file, "src/main.rs");
        assert_eq!(entries[0].index_status, b' ');
        assert_eq!(entries[0].wt_status, b'M');
        assert!(entries[0].orig.is_none());

        assert_eq!(entries[1].file, "Cargo.toml");
        assert_eq!(entries[1].index_status, b'M');
        assert_eq!(entries[1].wt_status, b' ');

        assert_eq!(entries[2].file, "notes.txt");
        assert_eq!(entries[2].index_status, b'?');
        assert_eq!(entries[2].wt_status, b'?');
    }

    #[test]
    fn test_parse_porcelain_z_handles_utf8_cjk_paths() {
        // Mandarin filename — valid UTF-8, should round-trip cleanly.
        let path = "src/笔记.md";
        let raw = build_z(&[format!(" M {path}").as_bytes()]);
        let entries = parse_status_porcelain_z(&raw);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].file, path);
    }

    #[test]
    fn test_parse_porcelain_z_handles_rename_pair() {
        // R<status> NEW \0 OLD \0 — ensure we consume both entries
        // and remember the source path under `orig`.
        let raw = build_z(&[b"R  src/new.rs", b"src/old.rs", b" M README.md"]);
        let entries = parse_status_porcelain_z(&raw);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].file, "src/new.rs");
        assert_eq!(entries[0].orig.as_deref(), Some("src/old.rs"));
        // Critical: the next entry is the unrelated README modification,
        // NOT the consumed source path.
        assert_eq!(entries[1].file, "README.md");
        assert!(entries[1].orig.is_none());
    }

    #[test]
    fn test_parse_porcelain_z_handles_copy_pair() {
        let raw = build_z(&[b"C  copy.rs", b"original.rs"]);
        let entries = parse_status_porcelain_z(&raw);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].file, "copy.rs");
        assert_eq!(entries[0].orig.as_deref(), Some("original.rs"));
    }

    #[test]
    fn test_parse_porcelain_z_skips_short_entries() {
        // Real `-z` output includes a trailing NUL, which produces an
        // empty trailing entry. Anything < 4 bytes is skipped.
        let raw = build_z(&[b" M ok.rs", b"", b"x"]);
        let entries = parse_status_porcelain_z(&raw);
        // Only the valid entry survives.
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].file, "ok.rs");
    }

    #[test]
    fn test_parse_porcelain_z_empty_input() {
        let entries = parse_status_porcelain_z(b"");
        assert_eq!(entries.len(), 0);
    }

    #[test]
    fn test_parse_porcelain_z_preserves_non_utf8_paths_lossily() {
        // Construct an entry whose path contains invalid UTF-8 (a lone
        // 0xFF byte). The parser must NOT crash; the path becomes a
        // lossy string but the rest of the parse still works.
        let mut raw = Vec::new();
        raw.extend_from_slice(b" M ok\xFFbad.rs");
        raw.push(0);
        raw.extend_from_slice(b" M next.rs");
        raw.push(0);
        let entries = parse_status_porcelain_z(&raw);
        assert_eq!(entries.len(), 2);
        // The next entry is unaffected — this is the win over the
        // previous "lossy the whole buffer first" approach where a
        // malformed path could shift offsets.
        assert_eq!(entries[1].file, "next.rs");
    }

    #[test]
    fn test_parse_porcelain_z_truncated_rename_does_not_consume_trailing_nul() {
        // Edge case: a rename entry with no source path, where the
        // buffer simply ends with the trailing NUL that real git output
        // always emits. The parser must not treat the empty trailing
        // slice as a valid source path; orig stays None.
        let raw = build_z(&[b"R  src/new.rs"]);
        let entries = parse_status_porcelain_z(&raw);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].file, "src/new.rs");
        assert!(
            entries[0].orig.is_none(),
            "truncated rename must not produce an empty-string source"
        );
    }
}

#[cfg(test)]
mod commit_graph_tests {
    use super::{
        merge_commit_files, parse_commit_graph, parse_name_status, parse_numstat, parse_shortstat,
        sha_is_safe,
    };

    #[test]
    fn parse_shortstat_extracts_files_ins_del() {
        assert_eq!(
            parse_shortstat(" 5 files changed, 12 insertions(+), 3 deletions(-)"),
            (5, 12, 3)
        );
        assert_eq!(
            parse_shortstat(" 1 file changed, 2 insertions(+)"),
            (1, 2, 0)
        );
        assert_eq!(
            parse_shortstat(" 1 file changed, 4 deletions(-)"),
            (1, 0, 4)
        );
        assert_eq!(parse_shortstat("not a stat line"), (0, 0, 0));
    }

    #[test]
    fn commit_graph_attaches_shortstat_to_preceding_commit() {
        let stdout = "h\u{1f}h\u{1f}A\u{1f}a@b.c\u{1f}\u{1f}\u{1f}\u{1f}feat\n\n 3 files changed, 9 insertions(+), 2 deletions(-)";
        let out = parse_commit_graph(stdout);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].files_changed, 3);
        assert_eq!(out[0].insertions, 9);
        assert_eq!(out[0].deletions, 2);
    }

    #[test]
    fn parse_name_status_handles_add_modify_delete_rename() {
        let ns =
            parse_name_status("A\tsrc/new.rs\nM\tsrc/main.rs\nD\told.rs\nR100\tsrc/a.rs\tsrc/b.rs");
        assert_eq!(ns.len(), 4);
        assert_eq!(ns[0], ('A', "src/new.rs".to_string(), None));
        assert_eq!(ns[1], ('M', "src/main.rs".to_string(), None));
        assert_eq!(ns[2], ('D', "old.rs".to_string(), None));
        assert_eq!(
            ns[3],
            ('R', "src/b.rs".to_string(), Some("src/a.rs".to_string()))
        );
    }

    #[test]
    fn parse_numstat_handles_counts_and_binary() {
        let nm = parse_numstat("12\t3\tsrc/main.rs\n-\t-\timg.png");
        assert_eq!(nm.len(), 2);
        assert_eq!(nm[0], (12, 3, false));
        assert_eq!(nm[1], (0, 0, true));
    }

    #[test]
    fn merge_commit_files_zips_by_order_and_labels() {
        let ns = parse_name_status("M\tsrc/main.rs\nR100\ta.rs\tb.rs");
        let nm = parse_numstat("5\t2\tsrc/main.rs\n0\t0\tb.rs");
        let files = merge_commit_files(ns, nm);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, "src/main.rs");
        assert_eq!(files[0].status, "M");
        assert_eq!(files[0].status_label, "Modified");
        assert_eq!((files[0].added, files[0].removed), (5, 2));
        assert_eq!(files[1].path, "b.rs");
        assert_eq!(files[1].original_path.as_deref(), Some("a.rs"));
        assert_eq!(files[1].status_label, "Renamed");
    }

    #[test]
    fn sha_is_safe_rejects_non_hex() {
        assert!(sha_is_safe("abc123def456"));
        assert!(!sha_is_safe(""));
        assert!(!sha_is_safe("../etc"));
        assert!(!sha_is_safe("abc; rm -rf"));
    }

    #[test]
    fn sha_is_safe_length_boundary() {
        assert!(sha_is_safe(&"a".repeat(64)));
        assert!(!sha_is_safe(&"a".repeat(65)));
    }

    #[test]
    fn subject_resembling_shortstat_is_not_misparsed() {
        // A commit whose SUBJECT looks like a shortstat must stay a 0/0/0 commit
        // — header lines carry the \x1f separator, shortstat lines never do.
        let stdout =
            "h\u{1f}h\u{1f}A\u{1f}a@b.c\u{1f}\u{1f}\u{1f}\u{1f}5 files changed, 10 insertions(+)";
        let out = parse_commit_graph(stdout);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].subject, "5 files changed, 10 insertions(+)");
        assert_eq!(
            (out[0].files_changed, out[0].insertions, out[0].deletions),
            (0, 0, 0)
        );
    }

    #[test]
    fn parse_name_status_handles_copy() {
        let ns = parse_name_status("C75\tsrc/a.rs\tsrc/b.rs");
        assert_eq!(
            ns[0],
            ('C', "src/b.rs".to_string(), Some("src/a.rs".to_string()))
        );
    }

    #[test]
    fn parses_fields_and_parents() {
        let line = "abc123\u{1f}abc\u{1f}Ada\u{1f}ada@x.io\u{1f}1700000000\u{1f}p1 p2\u{1f}\u{1f}merge: things";
        let out = parse_commit_graph(line);
        assert_eq!(out.len(), 1);
        let c = &out[0];
        assert_eq!(c.sha, "abc123");
        assert_eq!(c.short_sha, "abc");
        assert_eq!(c.author, "Ada");
        assert_eq!(c.author_email, "ada@x.io");
        assert_eq!(c.timestamp_secs, 1_700_000_000);
        assert_eq!(c.parents, vec!["p1".to_string(), "p2".to_string()]);
        assert!(c.refs.is_empty());
        assert_eq!(c.subject, "merge: things");
    }

    #[test]
    fn parses_decoration_refs() {
        let line = "h\u{1f}h\u{1f}A\u{1f}a@b.c\u{1f}1\u{1f}p\u{1f}HEAD -> main, origin/main, tag: v1.0\u{1f}release";
        let out = parse_commit_graph(line);
        assert_eq!(out.len(), 1);
        assert_eq!(
            out[0].refs,
            vec![
                "HEAD -> main".to_string(),
                "origin/main".to_string(),
                "tag: v1.0".to_string(),
            ]
        );
        assert_eq!(out[0].subject, "release");
    }

    #[test]
    fn root_commit_has_no_parents() {
        let line = "h\u{1f}h\u{1f}A\u{1f}a@b.c\u{1f}1\u{1f}\u{1f}\u{1f}initial";
        let out = parse_commit_graph(line);
        assert_eq!(out.len(), 1);
        assert!(out[0].parents.is_empty());
    }

    #[test]
    fn subject_keeps_separator_bytes() {
        let line = "h\u{1f}h\u{1f}A\u{1f}a@b.c\u{1f}1\u{1f}p\u{1f}\u{1f}a: b: c";
        let out = parse_commit_graph(line);
        assert_eq!(out[0].subject, "a: b: c");
    }

    #[test]
    fn malformed_lines_skipped_blank_lines_ignored() {
        let stdout = "not enough fields\n\nh\u{1f}h\u{1f}A\u{1f}a@b.c\u{1f}1\u{1f}\u{1f}\u{1f}ok";
        let out = parse_commit_graph(stdout);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].subject, "ok");
    }
}
