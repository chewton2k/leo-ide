use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use globset::{Glob, GlobSet, GlobSetBuilder};
use grep_regex::RegexMatcherBuilder;
use grep_searcher::sinks::UTF8;
use grep_searcher::{BinaryDetection, SearcherBuilder};
use ignore::{WalkBuilder, WalkState};
use serde::Serialize;

use super::to_canon;
use super::{validate_path, ProjectRootState};

const FILE_SIZE_CAP: u64 = 5 * 1024 * 1024;
const DEFAULT_MAX_RESULTS: usize = 200;
const HARD_MAX_RESULTS: usize = 2000;

fn build_globset(patterns: &[String]) -> Result<Option<GlobSet>, String> {
    if patterns.is_empty() {
        return Ok(None);
    }
    let mut b = GlobSetBuilder::new();
    for p in patterns {
        let g = Glob::new(p).map_err(|e| format!("bad glob {p:?}: {e}"))?;
        b.add(g);
    }
    let set = b.build().map_err(|e| format!("globset build: {e}"))?;
    Ok(Some(set))
}

#[derive(Serialize)]
pub struct GrepHit {
    pub path: String,
    pub rel: String,
    pub line: u64,
    pub text: String,
}

#[derive(Serialize)]
pub struct GrepResponse {
    pub hits: Vec<GrepHit>,
    pub truncated: bool,
    pub files_scanned: usize,
}

fn run_grep(
    root_path: &Path,
    pattern: &str,
    glob: &[String],
    case_insensitive: bool,
    cap: usize,
) -> Result<GrepResponse, String> {
    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(case_insensitive)
        .line_terminator(Some(b'\n'))
        .build(pattern)
        .map_err(|e| format!("bad regex: {e}"))?;

    let globs = build_globset(glob)?;

    let walker = WalkBuilder::new(root_path)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .parents(true)
        .follow_links(false)
        .build_parallel();

    let hits: Arc<Mutex<Vec<GrepHit>>> = Arc::new(Mutex::new(Vec::new()));
    let scanned = Arc::new(AtomicUsize::new(0));
    let truncated = Arc::new(AtomicBool::new(false));

    walker.run(|| {
        let matcher = matcher.clone();
        let globs = globs.clone();
        let hits = hits.clone();
        let scanned = scanned.clone();
        let truncated = truncated.clone();
        let root_path = root_path.to_path_buf();

        Box::new(move |dent_res| {
            if truncated.load(Ordering::Relaxed) {
                return WalkState::Quit;
            }
            let dent = match dent_res {
                Ok(d) => d,
                Err(_) => return WalkState::Continue,
            };
            if !dent.file_type().map(|t| t.is_file()).unwrap_or(false) {
                return WalkState::Continue;
            }
            let path = dent.path();
            let rel = match path.strip_prefix(&root_path) {
                Ok(r) => to_canon(r),
                Err(_) => return WalkState::Continue,
            };
            if let Some(set) = globs.as_ref() {
                if !set.is_match(&rel) {
                    return WalkState::Continue;
                }
            }
            if let Ok(meta) = std::fs::metadata(path) {
                if meta.len() > FILE_SIZE_CAP {
                    return WalkState::Continue;
                }
            }

            scanned.fetch_add(1, Ordering::Relaxed);

            let abs = to_canon(path);
            let rel_clone = rel.clone();
            let mut searcher = SearcherBuilder::new()
                .binary_detection(BinaryDetection::quit(b'\x00'))
                .line_number(true)
                .build();

            let _ = searcher.search_path(
                &matcher,
                path,
                UTF8(|line_num, text| {
                    let line_text = text.trim_end_matches('\n').to_string();
                    let mut guard = hits.lock().unwrap();
                    if guard.len() >= cap {
                        truncated.store(true, Ordering::Relaxed);
                        return Ok(false);
                    }
                    guard.push(GrepHit {
                        path: abs.clone(),
                        rel: rel_clone.clone(),
                        line: line_num,
                        text: line_text,
                    });
                    Ok(true)
                }),
            );

            WalkState::Continue
        })
    });

    let final_hits = Arc::try_unwrap(hits)
        .map(|m| m.into_inner().unwrap())
        .unwrap_or_default();

    Ok(GrepResponse {
        hits: final_hits,
        truncated: truncated.load(Ordering::Relaxed),
        files_scanned: scanned.load(Ordering::Relaxed),
    })
}

#[tauri::command]
pub fn fs_grep(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectRootState>,
    pattern: String,
    root: String,
    glob: Option<Vec<String>>,
    case_insensitive: Option<bool>,
    max_results: Option<usize>,
) -> Result<GrepResponse, String> {
    if pattern.is_empty() {
        return Err("empty pattern".into());
    }
    let root_path = validate_path(&root, window.label(), &state)?;
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }
    let cap = max_results
        .unwrap_or(DEFAULT_MAX_RESULTS)
        .clamp(1, HARD_MAX_RESULTS);
    run_grep(
        &root_path,
        &pattern,
        glob.as_deref().unwrap_or(&[]),
        case_insensitive.unwrap_or(false),
        cap,
    )
}

#[derive(Serialize)]
pub struct GlobHit {
    pub path: String,
    pub rel: String,
}

#[derive(Serialize)]
pub struct GlobResponse {
    pub hits: Vec<GlobHit>,
    pub truncated: bool,
}

fn run_glob(root_path: &Path, pattern: &str, cap: usize) -> Result<GlobResponse, String> {
    let glob = Glob::new(pattern).map_err(|e| format!("bad glob: {e}"))?;
    let mut gb = GlobSetBuilder::new();
    gb.add(glob);
    let set = gb.build().map_err(|e| format!("globset build: {e}"))?;

    let walker = WalkBuilder::new(root_path)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .parents(true)
        .follow_links(false)
        .build();

    let mut hits: Vec<GlobHit> = Vec::new();
    let mut truncated = false;
    for dent in walker.flatten() {
        if hits.len() >= cap {
            truncated = true;
            break;
        }
        if !dent.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let path = dent.path();
        let rel = match path.strip_prefix(root_path) {
            Ok(r) => to_canon(r),
            Err(_) => continue,
        };
        if !set.is_match(&rel) {
            continue;
        }
        hits.push(GlobHit {
            path: to_canon(path),
            rel,
        });
    }

    Ok(GlobResponse { hits, truncated })
}

#[tauri::command]
pub fn fs_glob(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectRootState>,
    pattern: String,
    root: String,
    max_results: Option<usize>,
) -> Result<GlobResponse, String> {
    if pattern.is_empty() {
        return Err("empty pattern".into());
    }
    let root_path = validate_path(&root, window.label(), &state)?;
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }
    let cap = max_results.unwrap_or(500).clamp(1, HARD_MAX_RESULTS);
    run_glob(&root_path, &pattern, cap)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn build_globset_empty_is_none() {
        assert!(build_globset(&[]).unwrap().is_none());
    }

    #[test]
    fn build_globset_rejects_bad_pattern() {
        assert!(build_globset(&["[".to_string()]).is_err());
    }

    #[test]
    fn grep_finds_matches_with_line_numbers() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.txt"), "alpha\nNEEDLE here\nbeta\n").unwrap();
        fs::write(dir.path().join("b.txt"), "nothing\n").unwrap();

        let res = run_grep(dir.path(), "NEEDLE", &[], false, 200).unwrap();
        assert_eq!(res.hits.len(), 1);
        assert_eq!(res.hits[0].line, 2);
        assert_eq!(res.hits[0].rel, "a.txt");
        assert!(res.hits[0].text.contains("NEEDLE"));
    }

    #[test]
    fn grep_case_insensitive_toggle() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.txt"), "Hello World\n").unwrap();
        assert_eq!(
            run_grep(dir.path(), "hello", &[], false, 200)
                .unwrap()
                .hits
                .len(),
            0
        );
        assert_eq!(
            run_grep(dir.path(), "hello", &[], true, 200)
                .unwrap()
                .hits
                .len(),
            1
        );
    }

    #[test]
    fn grep_respects_glob_filter() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("keep.rs"), "match me\n").unwrap();
        fs::write(dir.path().join("skip.txt"), "match me\n").unwrap();
        let res = run_grep(dir.path(), "match", &["*.rs".to_string()], false, 200).unwrap();
        assert_eq!(res.hits.len(), 1);
        assert_eq!(res.hits[0].rel, "keep.rs");
    }

    #[test]
    fn grep_truncates_at_cap() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.txt"), "x\nx\nx\nx\nx\n").unwrap();
        let res = run_grep(dir.path(), "x", &[], false, 2).unwrap();
        assert_eq!(res.hits.len(), 2);
        assert!(res.truncated);
    }

    #[test]
    fn glob_matches_by_relative_path() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("src")).unwrap();
        fs::write(dir.path().join("src/main.rs"), "").unwrap();
        fs::write(dir.path().join("readme.md"), "").unwrap();

        let res = run_glob(dir.path(), "**/*.rs", 500).unwrap();
        assert_eq!(res.hits.len(), 1);
        assert_eq!(res.hits[0].rel, "src/main.rs");
    }
}
