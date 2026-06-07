use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use crate::modules::fs::ProjectRootState;

// ── State ──
//
// SQLite (rusqlite + bundled libsqlite3) was replaced with plain JSON files
// stored at `~/.leo-ide/knowledge/<hash>.json`, 
// store-based persistence. This drops the bundled SQLite C library from the
// binary and the compile cost that came with it.
//
// Persistence model: each project's knowledge lives in a single JSON file
// (`KnowledgeDb`). Writers serialize through a per-hash async lock and persist
// via atomic temp-file + rename, so concurrent readers always observe either
// the old or the new complete file (never a torn write) and don't need to
// take the lock.

/// Per-project lock registry. Mutating commands acquire the lock for a given
/// db-hash before the load → mutate → save cycle so two writers can't clobber
/// each other's changes. Reads are lock-free (atomic rename guarantees a
/// consistent file on disk).
pub struct KnowledgeState {
    locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl Default for KnowledgeState {
    fn default() -> Self {
        Self::new()
    }
}

impl KnowledgeState {
    pub fn new() -> Self {
        Self {
            locks: Mutex::new(HashMap::new()),
        }
    }

    pub fn remove_window(&self, _label: &str) {}

    async fn lock_for(&self, hash: &str) -> Arc<Mutex<()>> {
        let mut map = self.locks.lock().await;
        map.entry(hash.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}

async fn validate_knowledge_root(
    project_root: &str,
    window_label: &str,
    state: &tauri::State<'_, ProjectRootState>,
) -> Result<PathBuf, String> {
    let root_guard = state.read().await;
    let active_root = root_guard
        .get(window_label)
        .and_then(|opt| opt.as_ref())
        .ok_or_else(|| "No project is open".to_string())?;

    let provided = PathBuf::from(project_root);

    // Fast path: direct match (covers the common case where both are the
    // same raw path, or both are already canonical).
    if provided == *active_root {
        return Ok(provided);
    }

    // Try canonicalizing the provided path to match against the stored
    // canonical root (set_project_root canonicalizes before storing).
    if let Ok(canonical) = std::fs::canonicalize(project_root) {
        if canonical == *active_root {
            return Ok(canonical);
        }
    }

    // On macOS, /tmp → /private/tmp and similar. Try stripping/adding /private.
    let active_str = active_root.to_string_lossy();
    let provided_str = project_root;
    if active_str.strip_prefix("/private") == Some(provided_str)
        || provided_str.strip_prefix("/private") == Some(active_str.as_ref())
    {
        return Ok(provided);
    }

    Err("Access denied: project root mismatch".to_string())
}

// ── Persisted model ──

#[derive(Serialize, Deserialize, Clone, Default)]
struct FileRecord {
    hash: String,
    language: String,
    size: i64,
    last_indexed: i64,
    summary: String,
    exports: String,
    mtime: i64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct ConversationRecord {
    title: String,
    created_at: i64,
    updated_at: i64,
    messages: String,
    generation: i64,
}

/// On-disk shape of a single project's knowledge store.
#[derive(Serialize, Deserialize, Default)]
struct KnowledgeDb {
    #[serde(default)]
    project_root: String,
    #[serde(default)]
    files: HashMap<String, FileRecord>,
    #[serde(default)]
    conversations: HashMap<String, ConversationRecord>,
}

// ── API response types ──

#[derive(Serialize, Clone)]
pub struct FileInfo {
    pub path: String,
    pub language: String,
    pub summary: String,
    pub exports: String,
}

#[derive(Serialize, Clone)]
pub struct ConversationSummary {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Clone)]
pub struct ProjectInfo {
    /// Filesystem path of the project root. "(unknown)" for stores that
    /// predate the project_root field (shouldn't happen for freshly-opened
    /// projects).
    pub project_root: String,
    /// First 16 hex chars of SHA-256(project_root) — matches the on-disk file name.
    pub db_hash: String,
    pub file_count: i64,
    pub conversation_count: i64,
    pub db_size_bytes: u64,
    /// Latest of `conversations.updated_at` and `files.last_indexed`, 0 when empty.
    pub last_updated: i64,
}

#[derive(Serialize, Clone)]
pub struct IndexProgress {
    pub done: u32,
    pub total: u32,
}

// ── Store path + (de)serialization ──

fn knowledge_dir() -> PathBuf {
    let dir = dirs::home_dir()
        .unwrap_or_default()
        .join(".leo-ide")
        .join("knowledge");
    std::fs::create_dir_all(&dir).ok();
    dir
}

fn db_hash_of(project_root: &str) -> String {
    let full = format!("{:x}", Sha256::digest(project_root.as_bytes()));
    full[..16].to_string()
}

fn db_path(project_root: &str) -> PathBuf {
    knowledge_dir().join(format!("{}.json", db_hash_of(project_root)))
}

/// Load a project's store. Returns an empty store when the file is missing or
/// unreadable/corrupt, so a single bad file never aborts an operation.
fn load_db(path: &Path) -> KnowledgeDb {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => KnowledgeDb::default(),
    }
}

/// Persist a project's store atomically: write to a sibling temp file then
/// rename over the target. A concurrent reader sees either the old or the new
/// complete file, never a partial write.
fn save_db(path: &Path, db: &KnowledgeDb) -> Result<(), String> {
    let json = serde_json::to_string(db).map_err(|e| format!("Serialize failed: {}", e))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json.as_bytes()).map_err(|e| format!("Write failed: {}", e))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("Rename failed: {}", e))?;
    Ok(())
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

/// Case-insensitive substring match, mirroring SQLite's default ASCII LIKE.
fn like_contains(haystack: &str, needle: &str) -> bool {
    haystack.to_lowercase().contains(&needle.to_lowercase())
}

// ── Cleanup ──

fn cleanup_old_data(db: &mut KnowledgeDb) {
    let now = now_secs();
    let thirty_days_ago = now - (30 * 24 * 60 * 60);
    let seven_days_ago = now - (7 * 24 * 60 * 60);

    // Drop conversations older than 30 days.
    db.conversations
        .retain(|_, c| c.updated_at >= thirty_days_ago);

    // Keep only the 50 most recent conversations.
    if db.conversations.len() > 50 {
        let mut by_recency: Vec<(String, i64)> = db
            .conversations
            .iter()
            .map(|(id, c)| (id.clone(), c.updated_at))
            .collect();
        by_recency.sort_by_key(|(_, updated)| std::cmp::Reverse(*updated));
        let keep: HashSet<String> = by_recency.into_iter().take(50).map(|(id, _)| id).collect();
        db.conversations.retain(|id, _| keep.contains(id));
    }

    // Remove file entries that haven't been re-indexed in 7 days (file was
    // probably deleted).
    db.files.retain(|_, f| f.last_indexed >= seven_days_ago);
}

// ── Commands ──

#[tauri::command]
pub async fn knowledge_init(
    window: tauri::WebviewWindow,
    project_root: String,
    state: tauri::State<'_, Arc<KnowledgeState>>,
    root_state: tauri::State<'_, ProjectRootState>,
) -> Result<(), String> {
    // Ensure the project root state is set for this window — if not yet set,
    // bootstrap it (handles race where knowledge_init fires before set_project_root).
    {
        let mut root_guard = root_state.write().await;
        let entry = root_guard.entry(window.label().to_string()).or_insert(None);
        if entry.is_none() {
            let canonical = std::fs::canonicalize(&project_root)
                .map_err(|e| format!("Invalid project root: {}", e))?;
            *entry = Some(canonical);
        }
    }
    validate_knowledge_root(&project_root, window.label(), &root_state).await?;

    let hash = db_hash_of(&project_root);
    let path = db_path(&project_root);

    let lock = state.lock_for(&hash).await;
    let _guard = lock.lock().await;

    let mut db = load_db(&path);
    // Record the project root so `knowledge_list_projects` can enumerate
    // stores by their originating path rather than just their content hash.
    db.project_root = project_root.clone();
    cleanup_old_data(&mut db);
    save_db(&path, &db)?;
    Ok(())
}

#[tauri::command]
pub async fn knowledge_index(
    window: tauri::WebviewWindow,
    project_root: String,
    app: AppHandle,
    state: tauri::State<'_, Arc<KnowledgeState>>,
    root_state: tauri::State<'_, ProjectRootState>,
) -> Result<(), String> {
    validate_knowledge_root(&project_root, window.label(), &root_state).await?;
    let root = PathBuf::from(&project_root);
    let window_label = window.label().to_string();
    let hash = db_hash_of(&project_root);
    let path = db_path(&project_root);

    // Snapshot the existing file index (lock-free) so the heavy walk can run
    // off-lock and still skip unchanged files.
    let old_files = load_db(&path).files;

    let new_files = tokio::task::spawn_blocking(move || -> HashMap<String, FileRecord> {
        let skip: HashSet<&str> = [
            "node_modules",
            ".git",
            "dist",
            "build",
            "target",
            ".next",
            "__pycache__",
            ".svelte-kit",
        ]
        .into_iter()
        .collect();
        let mut files: Vec<PathBuf> = Vec::new();
        walk_files(&root, &skip, &mut files);

        let total = files.len() as u32;
        let target = tauri::EventTarget::WebviewWindow {
            label: window_label.clone(),
        };
        let _ = app.emit_to(target.clone(), "indexing-progress", IndexProgress { done: 0, total });

        let mut new_files: HashMap<String, FileRecord> = HashMap::with_capacity(files.len());

        for (i, file) in files.iter().enumerate() {
            let rel = file
                .strip_prefix(&root)
                .unwrap_or(file)
                .to_string_lossy()
                .to_string();

            let mtime = std::fs::metadata(file)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);

            // Unchanged mtime → reuse the existing record verbatim.
            if let Some(existing) = old_files.get(&rel) {
                if existing.mtime == mtime && mtime > 0 {
                    new_files.insert(rel, existing.clone());
                    continue;
                }
            }

            // mtime changed or new file — read content.
            let Ok(content) = std::fs::read_to_string(file) else {
                continue;
            };
            let hash = format!("{:x}", Sha256::digest(content.as_bytes()));

            // Content unchanged (mtime changed but hash matches) → reuse the
            // record and just bump mtime.
            if let Some(existing) = old_files.get(&rel) {
                if existing.hash == hash {
                    let mut rec = existing.clone();
                    rec.mtime = mtime;
                    new_files.insert(rel, rec);
                    continue;
                }
            }

            let lang = detect_lang(file);
            let size = content.len() as i64;
            let summary = extract_summary(&content, &lang);
            let exports = extract_exports(&content, &lang);

            new_files.insert(
                rel,
                FileRecord {
                    hash,
                    language: lang,
                    size,
                    last_indexed: now_secs(),
                    summary,
                    exports,
                    mtime,
                },
            );

            if (i + 1) % 20 == 0 || i + 1 == files.len() {
                let _ = app.emit_to(
                    target.clone(),
                    "indexing-progress",
                    IndexProgress {
                        done: (i + 1) as u32,
                        total,
                    },
                );
            }
        }

        new_files
    })
    .await
    .map_err(|e| format!("Indexing failed: {}", e))?;

    // Briefly lock to merge the freshly built index in, preserving any
    // conversations saved while indexing ran.
    let lock = state.lock_for(&hash).await;
    let _guard = lock.lock().await;
    let mut db = load_db(&path);
    db.files = new_files;
    if db.project_root.is_empty() {
        db.project_root = project_root;
    }
    save_db(&path, &db)?;
    Ok(())
}

#[tauri::command]
pub async fn knowledge_get_context(
    window: tauri::WebviewWindow,
    project_root: String,
    query: String,
    current_file: Option<String>,
    root_state: tauri::State<'_, ProjectRootState>,
) -> Result<Vec<FileInfo>, String> {
    validate_knowledge_root(&project_root, window.label(), &root_state).await?;
    let db = load_db(&db_path(&project_root));

    // Deterministic iteration order (HashMap is unordered) so results are
    // stable across calls.
    let mut sorted: Vec<(&String, &FileRecord)> = db.files.iter().collect();
    sorted.sort_by(|a, b| a.0.cmp(b.0));

    let keywords: Vec<&str> = query.split_whitespace().filter(|w| w.len() > 2).collect();
    let mut results: Vec<FileInfo> = Vec::new();

    let make = |path: &str, rec: &FileRecord| FileInfo {
        path: path.to_string(),
        language: rec.language.clone(),
        summary: rec.summary.clone(),
        exports: rec.exports.clone(),
    };

    // 1. Files mentioned by name in the query (up to 3 per keyword).
    for kw in &keywords {
        let mut added = 0;
        for (path, rec) in &sorted {
            if added >= 3 {
                break;
            }
            if like_contains(path, kw) {
                if !results.iter().any(|x| &x.path == *path) {
                    results.push(make(path, rec));
                }
                added += 1;
            }
        }
    }

    // 2. Files in the same directory as the current file (up to 5).
    if let Some(ref cf) = current_file {
        if let Some((dir, _)) = cf.rsplit_once('/') {
            let prefix = format!("{}/", dir);
            let mut added = 0;
            for (path, rec) in &sorted {
                if added >= 5 {
                    break;
                }
                if path.to_lowercase().starts_with(&prefix.to_lowercase()) {
                    if !results.iter().any(|x| &x.path == *path) {
                        results.push(make(path, rec));
                    }
                    added += 1;
                }
            }
        }
    }

    // 3. Files matching keywords in their exports/summary (up to 3 per keyword).
    for kw in &keywords {
        let mut added = 0;
        for (path, rec) in &sorted {
            if added >= 3 {
                break;
            }
            if like_contains(&rec.exports, kw) || like_contains(&rec.summary, kw) {
                if !results.iter().any(|x| &x.path == *path) {
                    results.push(make(path, rec));
                }
                added += 1;
            }
        }
    }

    results.truncate(10);
    Ok(results)
}

// ── Conversation persistence ──

#[tauri::command]
#[allow(clippy::too_many_arguments)] // Tauri-injected params (window/state) + frontend args.
pub async fn knowledge_save_conversation(
    window: tauri::WebviewWindow,
    project_root: String,
    id: String,
    title: String,
    messages: String,
    generation: Option<u64>,
    state: tauri::State<'_, Arc<KnowledgeState>>,
    root_state: tauri::State<'_, ProjectRootState>,
) -> Result<bool, String> {
    validate_knowledge_root(&project_root, window.label(), &root_state).await?;
    let hash = db_hash_of(&project_root);
    let path = db_path(&project_root);
    let now = now_secs();
    let gen = generation.unwrap_or(0) as i64;

    let lock = state.lock_for(&hash).await;
    let _guard = lock.lock().await;

    let mut db = load_db(&path);

    // Reject stale writes — a newer generation already saved.
    if let Some(existing) = db.conversations.get(&id) {
        if existing.generation >= gen && gen > 0 {
            log::warn!(
                "Stale conversation save rejected: id={}, incoming_gen={}, existing_gen={}",
                id,
                gen,
                existing.generation
            );
            return Ok(false);
        }
    }

    let created_at = db
        .conversations
        .get(&id)
        .map(|c| c.created_at)
        .unwrap_or(now);

    db.conversations.insert(
        id,
        ConversationRecord {
            title,
            created_at,
            updated_at: now,
            messages,
            generation: gen,
        },
    );
    save_db(&path, &db)?;
    Ok(true)
}

#[tauri::command]
pub async fn knowledge_list_conversations(
    window: tauri::WebviewWindow,
    project_root: String,
    root_state: tauri::State<'_, ProjectRootState>,
) -> Result<Vec<ConversationSummary>, String> {
    validate_knowledge_root(&project_root, window.label(), &root_state).await?;
    let db = load_db(&db_path(&project_root));
    Ok(summaries(&db))
}

#[tauri::command]
pub async fn knowledge_load_conversation(
    window: tauri::WebviewWindow,
    project_root: String,
    id: String,
    root_state: tauri::State<'_, ProjectRootState>,
) -> Result<String, String> {
    validate_knowledge_root(&project_root, window.label(), &root_state).await?;
    let db = load_db(&db_path(&project_root));
    db.conversations
        .get(&id)
        .map(|c| c.messages.clone())
        .ok_or_else(|| "Not found".to_string())
}

#[tauri::command]
pub async fn knowledge_delete_conversations(
    window: tauri::WebviewWindow,
    project_root: String,
    state: tauri::State<'_, Arc<KnowledgeState>>,
    root_state: tauri::State<'_, ProjectRootState>,
) -> Result<(), String> {
    validate_knowledge_root(&project_root, window.label(), &root_state).await?;
    let hash = db_hash_of(&project_root);
    let path = db_path(&project_root);

    let lock = state.lock_for(&hash).await;
    let _guard = lock.lock().await;

    let mut db = load_db(&path);
    db.conversations.clear();
    save_db(&path, &db)?;
    Ok(())
}

#[tauri::command]
pub async fn knowledge_delete_conversation(
    window: tauri::WebviewWindow,
    project_root: String,
    id: String,
    state: tauri::State<'_, Arc<KnowledgeState>>,
    root_state: tauri::State<'_, ProjectRootState>,
) -> Result<(), String> {
    validate_knowledge_root(&project_root, window.label(), &root_state).await?;
    let hash = db_hash_of(&project_root);
    let path = db_path(&project_root);

    let lock = state.lock_for(&hash).await;
    let _guard = lock.lock().await;

    let mut db = load_db(&path);
    db.conversations.remove(&id);
    save_db(&path, &db)?;
    Ok(())
}

/// Enumerate all known projects by scanning `~/.leo-ide/knowledge/*.json`.
///
/// For each store we read the `project_root` recorded at `knowledge_init`
/// time. Stores that predate that field fall back to "(unknown)" and still
/// report their stats — so orphaned / unknown stores remain visible and
/// deletable in the UI.
///
/// Individual read errors yield an empty store (skipped from results), so a
/// single corrupt file can't break listing.
#[tauri::command]
pub async fn knowledge_list_projects(
    window: tauri::WebviewWindow,
) -> Result<Vec<ProjectInfo>, String> {
    require_settings_window(&window)?;
    let dir = knowledge_dir();
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let read_dir = match std::fs::read_dir(&dir) {
        Ok(r) => r,
        Err(e) => return Err(format!("Failed to read knowledge dir: {}", e)),
    };

    let mut projects: Vec<ProjectInfo> = Vec::new();
    for entry in read_dir.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        // Skip temp files from interrupted writes.
        let stem = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };

        let db = load_db(&path);
        let project_root = if db.project_root.is_empty() {
            "(unknown)".to_string()
        } else {
            db.project_root.clone()
        };

        let file_count = db.files.len() as i64;
        let conversation_count = db.conversations.len() as i64;
        let conv_max = db.conversations.values().map(|c| c.updated_at).max();
        let files_max = db.files.values().map(|f| f.last_indexed).max();
        let last_updated = conv_max.unwrap_or(0).max(files_max.unwrap_or(0));
        let db_size_bytes = path.metadata().map(|m| m.len()).unwrap_or(0);

        projects.push(ProjectInfo {
            project_root,
            db_hash: stem,
            file_count,
            conversation_count,
            db_size_bytes,
            last_updated,
        });
    }

    // Most recently touched first.
    projects.sort_by_key(|p| std::cmp::Reverse(p.last_updated));
    Ok(projects)
}

/// Delete an entire project's knowledge store.
#[tauri::command]
pub async fn knowledge_delete_project(
    window: tauri::WebviewWindow,
    project_root: String,
    state: tauri::State<'_, Arc<KnowledgeState>>,
) -> Result<(), String> {
    require_settings_window(&window)?;
    let hash = db_hash_of(&project_root);
    let path = db_path(&project_root);

    let lock = state.lock_for(&hash).await;
    let _guard = lock.lock().await;

    remove_store_files(&path);
    Ok(())
}

/// Delete a project's knowledge store by its hash. Used for orphan projects
/// where the original project_root is unknown.
#[tauri::command]
pub async fn knowledge_delete_by_hash(
    window: tauri::WebviewWindow,
    db_hash: String,
    state: tauri::State<'_, Arc<KnowledgeState>>,
) -> Result<(), String> {
    require_settings_window(&window)?;
    // Validate hash format: exactly 16 hex chars.
    if !db_hash.chars().all(|c| c.is_ascii_hexdigit()) || db_hash.len() != 16 {
        return Err("Invalid db_hash: must be exactly 16 hex characters".to_string());
    }

    let dir = knowledge_dir();
    let path = dir.join(format!("{}.json", db_hash));

    // Defense-in-depth: verify the path is inside knowledge_dir.
    if !path.starts_with(&dir) {
        return Err("Invalid db_hash: path traversal detected".to_string());
    }

    let lock = state.lock_for(&db_hash).await;
    let _guard = lock.lock().await;

    log::info!("Deleting knowledge store by hash: {}", db_hash);
    remove_store_files(&path);
    Ok(())
}

/// Delete every project's knowledge store. Used by the "Clear all knowledge"
/// global action. Silently skips any file it can't remove so partial failures
/// don't abort the operation.
#[tauri::command]
pub async fn knowledge_delete_all_projects(
    window: tauri::WebviewWindow,
    _state: tauri::State<'_, Arc<KnowledgeState>>,
) -> Result<(), String> {
    require_settings_window(&window)?;
    let dir = knowledge_dir();
    if !dir.exists() {
        return Ok(());
    }
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Ok(());
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            let _ = std::fs::remove_file(&path);
        }
    }
    Ok(())
}

// ── Admin commands (settings window — no per-window project root required) ──

/// Validate that a project_root has a corresponding knowledge store on disk.
/// Used by admin commands that don't require per-window project root validation.
fn validate_admin_db_access(project_root: &str) -> Result<PathBuf, String> {
    if project_root.is_empty() || project_root == "(unknown)" {
        return Err("Invalid project root".to_string());
    }
    let path = db_path(project_root);
    if !path.exists() {
        return Err("No knowledge store exists for this project".to_string());
    }
    // Ensure the resolved path is inside the knowledge directory.
    let dir = knowledge_dir();
    if !path.starts_with(&dir) {
        return Err("Invalid project root: path traversal detected".to_string());
    }
    Ok(path)
}

/// The dedicated settings window's label. Admin/global knowledge commands
/// are restricted to this window so an ordinary project window (or a
/// compromised webview in one) cannot enumerate or delete other projects'
/// stores.
pub(crate) const SETTINGS_WINDOW_LABEL: &str = "settings";

pub(crate) fn is_settings_window_label(label: &str) -> bool {
    label == SETTINGS_WINDOW_LABEL
}

/// Verify the calling window is the settings window.
fn require_settings_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if !is_settings_window_label(window.label()) {
        return Err(
            "Access denied: admin commands are only available from the settings window".to_string(),
        );
    }
    Ok(())
}

/// List conversations for a project — callable only from the settings window.
#[tauri::command]
pub async fn knowledge_admin_list_conversations(
    window: tauri::WebviewWindow,
    project_root: String,
) -> Result<Vec<ConversationSummary>, String> {
    require_settings_window(&window)?;
    let path = validate_admin_db_access(&project_root)?;
    let db = load_db(&path);
    Ok(summaries(&db))
}

/// Load a conversation — callable only from the settings window.
#[tauri::command]
pub async fn knowledge_admin_load_conversation(
    window: tauri::WebviewWindow,
    project_root: String,
    id: String,
) -> Result<String, String> {
    require_settings_window(&window)?;
    let path = validate_admin_db_access(&project_root)?;
    let db = load_db(&path);
    db.conversations
        .get(&id)
        .map(|c| c.messages.clone())
        .ok_or_else(|| "Not found".to_string())
}

/// Delete a single conversation — callable only from the settings window.
#[tauri::command]
pub async fn knowledge_admin_delete_conversation(
    window: tauri::WebviewWindow,
    project_root: String,
    id: String,
    state: tauri::State<'_, Arc<KnowledgeState>>,
) -> Result<(), String> {
    require_settings_window(&window)?;
    let path = validate_admin_db_access(&project_root)?;
    let hash = db_hash_of(&project_root);

    let lock = state.lock_for(&hash).await;
    let _guard = lock.lock().await;

    let mut db = load_db(&path);
    db.conversations.remove(&id);
    save_db(&path, &db)?;
    Ok(())
}

/// Delete all conversations for a project — callable only from the settings window.
#[tauri::command]
pub async fn knowledge_admin_delete_conversations(
    window: tauri::WebviewWindow,
    project_root: String,
    state: tauri::State<'_, Arc<KnowledgeState>>,
) -> Result<(), String> {
    require_settings_window(&window)?;
    let path = validate_admin_db_access(&project_root)?;
    let hash = db_hash_of(&project_root);

    let lock = state.lock_for(&hash).await;
    let _guard = lock.lock().await;

    let mut db = load_db(&path);
    db.conversations.clear();
    save_db(&path, &db)?;
    Ok(())
}

// ── Helpers ──

/// Build conversation summaries sorted by most-recently-updated, capped at 50.
fn summaries(db: &KnowledgeDb) -> Vec<ConversationSummary> {
    let mut out: Vec<ConversationSummary> = db
        .conversations
        .iter()
        .map(|(id, c)| ConversationSummary {
            id: id.clone(),
            title: c.title.clone(),
            created_at: c.created_at,
            updated_at: c.updated_at,
        })
        .collect();
    out.sort_by_key(|s| std::cmp::Reverse(s.updated_at));
    out.truncate(50);
    out
}

/// Remove a store file and any leftover temp sidecar.
fn remove_store_files(path: &Path) {
    if path.exists() {
        let _ = std::fs::remove_file(path);
    }
    let tmp = path.with_extension("json.tmp");
    if tmp.exists() {
        let _ = std::fs::remove_file(tmp);
    }
}

fn walk_files(dir: &Path, skip: &HashSet<&str>, files: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            if !skip.contains(name.as_ref()) && !name.starts_with('.') {
                walk_files(&path, skip, files);
            }
        } else {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if matches!(
                ext,
                "js" | "jsx"
                    | "ts"
                    | "tsx"
                    | "svelte"
                    | "rs"
                    | "py"
                    | "go"
                    | "java"
                    | "css"
                    | "html"
                    | "json"
                    | "md"
                    | "toml"
                    | "yaml"
                    | "yml"
                    | "sql"
                    | "sh"
                    | "vue"
            ) && path.metadata().map(|m| m.len() < 500_000).unwrap_or(false)
            {
                files.push(path);
            }
        }
    }
}

fn detect_lang(path: &Path) -> String {
    match path.extension().and_then(|e| e.to_str()) {
        Some("js" | "jsx" | "mjs") => "javascript",
        Some("ts" | "tsx" | "mts") => "typescript",
        Some("svelte") => "svelte",
        Some("rs") => "rust",
        Some("py") => "python",
        Some("go") => "go",
        Some("java") => "java",
        Some("css") => "css",
        Some("html") => "html",
        Some("json") => "json",
        Some("md") => "markdown",
        _ => "other",
    }
    .to_string()
}

fn extract_summary(content: &str, _lang: &str) -> String {
    let lines: Vec<&str> = content.lines().take(5).collect();
    // First meaningful comment or first few lines.
    let mut summary = String::new();
    for line in &lines {
        let t = line.trim();
        if t.starts_with("//") || t.starts_with("#") || t.starts_with("/*") || t.starts_with("*") {
            summary.push_str(t.trim_start_matches(['/', '*', '#', ' ']));
            summary.push(' ');
        }
    }
    if summary.is_empty() {
        summary = lines.join(" ");
    }
    summary.chars().take(200).collect()
}

fn extract_exports(content: &str, lang: &str) -> String {
    let mut exports = Vec::new();
    for line in content.lines() {
        let t = line.trim();
        match lang {
            "javascript" | "typescript" | "svelte" if t.starts_with("export ") => {
                let name = t
                    .split_whitespace()
                    .nth(2)
                    .or_else(|| t.split_whitespace().nth(1))
                    .unwrap_or("")
                    .split('(')
                    .next()
                    .unwrap_or("")
                    .trim_end_matches(|c: char| !c.is_alphanumeric() && c != '_');
                if !name.is_empty() && name != "{" {
                    exports.push(name.to_string());
                }
            }
            "rust" => {
                if t.starts_with("pub fn ") || t.starts_with("pub async fn ") {
                    let name = t
                        .split("fn ")
                        .nth(1)
                        .unwrap_or("")
                        .split('(')
                        .next()
                        .unwrap_or("")
                        .trim();
                    if !name.is_empty() {
                        exports.push(name.to_string());
                    }
                } else if t.starts_with("pub struct ") || t.starts_with("pub enum ") {
                    let name = t
                        .split_whitespace()
                        .nth(2)
                        .unwrap_or("")
                        .split(|c: char| !c.is_alphanumeric() && c != '_')
                        .next()
                        .unwrap_or("");
                    if !name.is_empty() {
                        exports.push(name.to_string());
                    }
                }
            }
            "python" => {
                if t.starts_with("def ") && !t.starts_with("def _") {
                    let name = t
                        .trim_start_matches("def ")
                        .split('(')
                        .next()
                        .unwrap_or("")
                        .trim();
                    if !name.is_empty() {
                        exports.push(name.to_string());
                    }
                } else if t.starts_with("class ") {
                    let name = t
                        .trim_start_matches("class ")
                        .split(|c: char| !c.is_alphanumeric() && c != '_')
                        .next()
                        .unwrap_or("");
                    if !name.is_empty() {
                        exports.push(name.to_string());
                    }
                }
            }
            _ => {}
        }
        if exports.len() >= 20 {
            break;
        }
    }
    exports.join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── G (LOW): settings-window gating for global/admin commands ──

    #[test]
    fn only_settings_label_is_authorized_for_admin() {
        assert!(is_settings_window_label("settings"));
        assert!(!is_settings_window_label("main"));
        assert!(!is_settings_window_label("win-2"));
        assert!(!is_settings_window_label("Settings")); // case-sensitive
        assert!(!is_settings_window_label(""));
    }

    #[test]
    fn db_hash_is_16_hex_chars() {
        let h = db_hash_of("/Users/dev/project");
        assert_eq!(h.len(), 16);
        assert!(h.chars().all(|c| c.is_ascii_hexdigit()));
        // Deterministic for the same root.
        assert_eq!(h, db_hash_of("/Users/dev/project"));
        // Different roots → different hashes.
        assert_ne!(h, db_hash_of("/Users/dev/other"));
    }
}
