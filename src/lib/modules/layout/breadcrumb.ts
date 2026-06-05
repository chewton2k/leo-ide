/**
 * Pure helpers for the toolbar breadcrumb that live above the editor.
 *
 * Extracted from `App.svelte` so the segmentation logic is testable in
 * isolation and the host component stays focused on layout / wiring.
 *
 * Conventions:
 *
 *  - Backslashes are normalized to forward slashes so Windows paths look
 *    the same as POSIX paths in the breadcrumb. We don't otherwise
 *    canonicalize: callers pass `$activeFilePath` and `$projectRoot`
 *    which are already canonical.
 *  - The first segment is always the project-root directory name
 *    (so users can click it to navigate "up to root"), with subsequent
 *    segments being each path component in order.
 *  - When the active file is *outside* the project root (rare — drag/drop
 *    of an external file, recovered session pointing at a moved folder),
 *    we fall back to a single segment showing just the basename.
 */

export interface BreadcrumbSegment {
  /** Display label for the segment. */
  name: string;
  /** Absolute path the segment points to (for click-to-navigate). */
  path: string;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Compute the breadcrumb segments for an active file relative to a
 * project root. Returns `[]` when no file is open.
 */
export function breadcrumbSegmentsFor(
  activeFilePath: string | null | undefined,
  projectRoot: string | null | undefined,
): BreadcrumbSegment[] {
  if (!activeFilePath) return [];

  const normPath = toPosix(activeFilePath);
  const normRoot = projectRoot ? toPosix(projectRoot) : null;

  if (normRoot && normPath.startsWith(normRoot + '/')) {
    const rel = normPath.slice(normRoot.length + 1);
    const relParts = rel.split('/');
    const rootName = normRoot.split('/').pop() || normRoot;
    return [
      { name: rootName, path: normRoot },
      ...relParts.map((part, i) => ({
        name: part,
        path: normRoot + '/' + relParts.slice(0, i + 1).join('/'),
      })),
    ];
  }

  return [{ name: normPath.split('/').pop() || activeFilePath, path: normPath }];
}

/**
 * Breadcrumb segments for a terminal's current working directory — ported from
 * user's home dir (else the drive root on Windows, or `/`); each subsequent
 * segment carries the absolute path so it can be clicked to navigate.
 */
export function cwdBreadcrumbSegments(
  cwd: string | null | undefined,
  home: string | null | undefined,
): BreadcrumbSegment[] {
  if (!cwd) return [];
  const normCwd = toPosix(cwd);
  const normHome = home ? toPosix(home) : null;
  const usingHome =
    normHome !== null && (normCwd === normHome || normCwd.startsWith(normHome + '/'));

  let root: BreadcrumbSegment;
  let tail: string;
  if (usingHome) {
    root = { name: '~', path: normHome! };
    tail = normCwd.slice(normHome!.length).replace(/^\//, '');
  } else {
    const drive = /^([A-Za-z]:)(.*)$/.exec(normCwd);
    if (drive) {
      root = { name: drive[1], path: drive[1] + '/' };
      tail = drive[2].replace(/^\//, '');
    } else {
      root = { name: '/', path: '/' };
      tail = normCwd.replace(/^\//, '');
    }
  }

  const parts = tail === '' ? [] : tail.split('/').filter(Boolean);
  const segments: BreadcrumbSegment[] = [root];
  let acc = root.path;
  for (const part of parts) {
    acc = acc.endsWith('/') ? acc + part : acc + '/' + part;
    segments.push({ name: part, path: acc });
  }
  return segments;
}
