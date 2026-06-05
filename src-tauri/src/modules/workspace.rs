use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const CANONICAL_TTL: Duration = Duration::from_secs(1);
const CANONICAL_CACHE_CAP: usize = 256;

struct CanonicalEntry {
    canonical: PathBuf,
    inserted_at: Instant,
}

/// Tracks authorized workspace roots and a short-lived canonicalize cache.
/// Additive hardening: it does not yet gate existing fs/pty validation (which
/// keeps its own per-window project-root sandbox); it is available for callers
/// that want symlink-resolved authorization + cheaper repeated canonicalize.
#[derive(Default)]
pub struct WorkspaceRegistry {
    roots: Mutex<HashSet<PathBuf>>,
    canonical_cache: Mutex<HashMap<PathBuf, CanonicalEntry>>,
}

impl WorkspaceRegistry {
    /// Canonicalize `path` and register it as an authorized root.
    pub fn authorize<P: AsRef<Path>>(&self, path: P) -> std::io::Result<PathBuf> {
        let canonical = std::fs::canonicalize(path.as_ref())?;
        self.roots
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(canonical.clone());
        Ok(canonical)
    }

    /// True when `target` sits under any authorized root.
    pub fn is_authorized(&self, target: &Path) -> bool {
        let set = self.roots.lock().unwrap_or_else(|e| e.into_inner());
        set.iter().any(|root| target.starts_with(root))
    }

    /// Canonicalize with a TTL cache to coalesce the burst of calls during a
    /// file-tree refresh. The short TTL keeps the TOCTOU window tight.
    pub fn canonicalize_cached<P: AsRef<Path>>(&self, path: P) -> std::io::Result<PathBuf> {
        let key = path.as_ref().to_path_buf();
        {
            let cache = self
                .canonical_cache
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if let Some(entry) = cache.get(&key) {
                if entry.inserted_at.elapsed() < CANONICAL_TTL {
                    return Ok(entry.canonical.clone());
                }
            }
        }
        let canonical = std::fs::canonicalize(&key)?;
        let mut cache = self
            .canonical_cache
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if cache.len() >= CANONICAL_CACHE_CAP {
            cache.retain(|_, e| e.inserted_at.elapsed() < CANONICAL_TTL);
            if cache.len() >= CANONICAL_CACHE_CAP {
                cache.clear();
            }
        }
        cache.insert(
            key,
            CanonicalEntry {
                canonical: canonical.clone(),
                inserted_at: Instant::now(),
            },
        );
        Ok(canonical)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn empty_registry_authorizes_nothing() {
        let reg = WorkspaceRegistry::default();
        assert!(!reg.is_authorized(Path::new("/tmp")));
    }

    #[test]
    fn authorize_then_descendants_are_authorized() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("sub");
        fs::create_dir(&sub).unwrap();
        let reg = WorkspaceRegistry::default();
        let root = reg.authorize(dir.path()).unwrap();
        assert!(reg.is_authorized(&root.join("sub")));
        assert!(reg.is_authorized(&root.join("a/b/c")));
    }

    #[test]
    fn unrelated_paths_are_not_authorized() {
        let dir = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let reg = WorkspaceRegistry::default();
        reg.authorize(dir.path()).unwrap();
        let other_canon = std::fs::canonicalize(other.path()).unwrap();
        assert!(!reg.is_authorized(&other_canon));
    }

    #[test]
    fn sibling_with_shared_name_prefix_is_not_authorized() {
        let base = tempfile::tempdir().unwrap();
        let foo = base.path().join("foo");
        let foobar = base.path().join("foobar");
        fs::create_dir(&foo).unwrap();
        fs::create_dir(&foobar).unwrap();
        let reg = WorkspaceRegistry::default();
        reg.authorize(&foo).unwrap();
        // /base/foobar shares a string prefix with /base/foo but is NOT a descendant.
        assert!(!reg.is_authorized(&std::fs::canonicalize(&foobar).unwrap()));
    }

    #[test]
    fn canonicalize_cached_matches_direct_and_errors_on_missing() {
        let dir = tempfile::tempdir().unwrap();
        let reg = WorkspaceRegistry::default();
        let direct = std::fs::canonicalize(dir.path()).unwrap();
        assert_eq!(reg.canonicalize_cached(dir.path()).unwrap(), direct);
        // Second call (cache hit) returns the same value.
        assert_eq!(reg.canonicalize_cached(dir.path()).unwrap(), direct);
        assert!(reg.canonicalize_cached(dir.path().join("nope")).is_err());
    }
}
