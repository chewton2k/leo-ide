<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { open as openUrl } from '@tauri-apps/plugin-shell';
  import { RefreshCw, GitBranch, Copy, ExternalLink, FileText, X } from 'lucide-svelte';
  import { projectRoot } from '../../modules';
  import { layoutGraph, type GraphRow } from '../../modules/git/graph';
  import { parseRemoteWebUrl, commitWebUrl, hostLabel, type RemoteWebInfo } from '../../modules/git/remoteWebUrl';
  import GraphRail from './GraphRail.svelte';

  interface CommitEntry {
    sha: string;
    short_sha: string;
    author: string;
    author_email: string;
    timestamp_secs: number;
    parents: string[];
    subject: string;
    refs: string[];
    files_changed: number;
    insertions: number;
    deletions: number;
  }
  interface CommitFile {
    path: string;
    original_path: string | null;
    status: string;
    status_label: string;
    added: number;
    removed: number;
    is_binary: boolean;
  }
  interface DiffLine { kind: string; old_num: number | null; new_num: number | null; text: string; }

  const ROW_H = 28;

  let commits = $state<CommitEntry[]>([]);
  let rows = $state<GraphRow[]>([]);
  let loading = $state(false);
  let loaded = $state(false);
  let remoteWeb = $state<RemoteWebInfo | null>(null);

  let selectedSha = $state<string | null>(null);
  let files = $state<CommitFile[]>([]);
  let filesLoading = $state(false);
  let copied = $state(false);
  let expandedFile = $state<string | null>(null);
  let fileDiff = $state<DiffLine[]>([]);
  let fileDiffLoading = $state(false);

  let selected = $derived(commits.find(c => c.sha === selectedSha) ?? null);
  let commitUrl = $derived(selected && remoteWeb ? commitWebUrl(remoteWeb, selected.sha) : null);

  async function load() {
    const root = $projectRoot;
    if (!root) return;
    loading = true;
    try {
      commits = await invoke<CommitEntry[]>('git_commit_graph', { repoPath: root, count: 200 });
      rows = layoutGraph(commits).rows;
    } catch {
      commits = [];
      rows = [];
    }
    selectedSha = null;
    loading = false;
    loaded = true;
    invoke<string | null>('git_remote_url', { repoPath: root })
      .then(url => { remoteWeb = parseRemoteWebUrl(url); })
      .catch(() => { remoteWeb = null; });
  }

  async function selectCommit(sha: string) {
    if (selectedSha === sha) { selectedSha = null; return; }
    selectedSha = sha;
    expandedFile = null;
    fileDiff = [];
    files = [];
    const root = $projectRoot;
    if (!root) return;
    filesLoading = true;
    try {
      files = await invoke<CommitFile[]>('git_commit_files', { repoPath: root, sha });
    } catch {
      files = [];
    }
    filesLoading = false;
  }

  async function openFile(file: CommitFile) {
    if (expandedFile === file.path) { expandedFile = null; fileDiff = []; return; }
    expandedFile = file.path;
    fileDiff = [];
    const root = $projectRoot;
    if (!root || !selectedSha) return;
    fileDiffLoading = true;
    try {
      fileDiff = await invoke<DiffLine[]>('git_commit_file_diff', { repoPath: root, sha: selectedSha, filePath: file.path });
    } catch {
      fileDiff = [];
    }
    fileDiffLoading = false;
  }

  async function copySha() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.sha);
      copied = true;
      setTimeout(() => { copied = false; }, 1100);
    } catch { /* clipboard unavailable */ }
  }

  function openCommitUrl() {
    if (commitUrl) openUrl(commitUrl).catch(() => {});
  }

  function relTime(secs: number): string {
    const d = Math.floor(Date.now() / 1000) - secs;
    if (d < 60) return 'just now';
    if (d < 3600) return `${Math.floor(d / 60)}m ago`;
    if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
    if (d < 2592000) return `${Math.floor(d / 86400)}d ago`;
    return new Date(secs * 1000).toLocaleDateString();
  }

  function absTime(secs: number): string {
    if (!secs) return '';
    return new Date(secs * 1000).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  function basename(p: string): string {
    const parts = p.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : p;
  }
  function dirname(p: string): string {
    const i = p.lastIndexOf('/');
    return i <= 0 ? '' : p.slice(0, i);
  }
  function statusColor(s: string): string {
    switch (s.toUpperCase()) {
      case 'A': return 'var(--success)';
      case 'M': return 'var(--warning)';
      case 'D': return 'var(--error)';
      case 'R': case 'C': return 'var(--git-graph-accent)';
      default: return 'var(--text-muted)';
    }
  }

  $effect(() => {
    // Reload whenever the project changes (and on first mount).
    $projectRoot;
    load();
  });
</script>

<div class="graph-view">
  <div class="graph-header">
    <div class="graph-title"><GitBranch size={14} /> <span>Git Graph</span></div>
    <button class="graph-refresh" onclick={load} title="Refresh" aria-label="Refresh graph">
      <RefreshCw size={13} class={loading ? 'spin-once' : ''} />
    </button>
  </div>

  {#if !$projectRoot}
    <div class="graph-empty">No project open.</div>
  {:else if loading && rows.length === 0}
    <div class="graph-empty">Loading history…</div>
  {:else if loaded && rows.length === 0}
    <div class="graph-empty">No commits.</div>
  {:else}
    <div class="graph-rows">
      {#each rows as row, i (row.sha)}
        {@const c = commits[i]}
        <button class="graph-row" class:selected={c?.sha === selectedSha} style:height="{ROW_H}px" onclick={() => c && selectCommit(c.sha)}>
          <GraphRail {row} rowHeight={ROW_H} />
          <span class="sha">{c?.short_sha ?? ''}</span>
          {#if c?.refs?.length}
            {#each c.refs as r}
              <span class="ref" class:tag={r.startsWith('tag:')} class:head={r.includes('HEAD')}>{r.replace(/^tag:\s*/, '')}</span>
            {/each}
          {/if}
          <span class="subject" title={c?.subject ?? ''}>{c?.subject ?? ''}</span>
          <span class="author" title={c?.author_email || c?.author}>{c?.author ?? ''}</span>
          <span class="date">{#if c}{relTime(c.timestamp_secs)}{/if}</span>
          <span class="changes">
            {#if c && c.files_changed > 0}
              <span class="files-count" title="{c.files_changed} files changed">{c.files_changed}<FileText size={10} /></span>
            {/if}
            {#if c && c.insertions > 0}<span class="ins">+{c.insertions}</span>{/if}
            {#if c && c.deletions > 0}<span class="del">−{c.deletions}</span>{/if}
          </span>
        </button>
      {/each}
    </div>

    {#if selected}
      <div class="detail">
        <div class="detail-head">
          <span class="detail-sha">{selected.short_sha}</span>
          <span class="detail-subject" title={selected.subject}>{selected.subject || '(no subject)'}</span>
          <button class="detail-close" onclick={() => (selectedSha = null)} title="Close" aria-label="Close detail"><X size={13} /></button>
        </div>
        <div class="detail-meta">
          <span>{selected.author || 'Unknown'}</span>
          {#if selected.author_email}<span class="dot">·</span><span class="email">{selected.author_email}</span>{/if}
          <span class="dot">·</span><span>{absTime(selected.timestamp_secs)}</span>
        </div>
        <div class="detail-actions">
          <button class="action-btn" onclick={copySha}><Copy size={11} /> {copied ? 'Copied' : 'Copy SHA'}</button>
          {#if commitUrl && remoteWeb}
            <button class="action-btn" onclick={openCommitUrl}><ExternalLink size={11} /> {hostLabel(remoteWeb)}</button>
          {/if}
        </div>

        <div class="files">
          {#if filesLoading}
            <div class="files-loading">Loading files…</div>
          {:else if files.length === 0}
            <div class="files-loading">No file changes.</div>
          {:else}
            <div class="files-label">Files <span class="files-badge">{files.length}</span></div>
            {#each files as file (file.path)}
              <button class="file-row" class:expanded={expandedFile === file.path} onclick={() => openFile(file)}>
                <span class="file-name" title={file.path}>{basename(file.path)}</span>
                <span class="file-dir" title={file.path}>{dirname(file.path)}</span>
                <span class="file-stat">
                  {#if file.is_binary}
                    <span class="bin">binary</span>
                  {:else}
                    {#if file.added > 0}<span class="ins">+{file.added}</span>{/if}
                    {#if file.removed > 0}<span class="del">−{file.removed}</span>{/if}
                  {/if}
                </span>
                <span class="file-status" style="color: {statusColor(file.status)}" title={file.status_label}>{file.status.toUpperCase()}</span>
              </button>
              {#if expandedFile === file.path}
                <div class="file-diff">
                  {#if fileDiffLoading}
                    <div class="files-loading">Loading diff…</div>
                  {:else if fileDiff.length === 0}
                    <div class="files-loading">No textual diff.</div>
                  {:else}
                    {#each fileDiff as line}
                      <div class="diff-line {line.kind}"><span class="diff-text">{line.text}</span></div>
                    {/each}
                  {/if}
                </div>
              {/if}
            {/each}
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .graph-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    background: var(--bg-primary);
    color: var(--text-primary);
    overflow: hidden;
  }
  .graph-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .graph-title { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; }
  .graph-refresh {
    display: flex; align-items: center; justify-content: center;
    width: 26px; height: 26px; border-radius: 5px;
    color: var(--text-muted); cursor: pointer;
  }
  .graph-refresh:hover { background: var(--bg-surface); color: var(--text-primary); }
  .graph-empty { padding: 24px; color: var(--text-muted); font-size: 13px; }
  .graph-rows { flex: 1; overflow-y: auto; padding: 4px 12px; min-height: 0; }
  .graph-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    width: 100%;
    background: none;
    border: none;
    border-left: 2px solid transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .graph-row:hover { background: color-mix(in srgb, var(--bg-surface) 70%, transparent); }
  .graph-row.selected {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border-left-color: var(--accent);
  }
  .sha {
    font-family: var(--font-mono, monospace);
    color: var(--text-muted);
    flex-shrink: 0;
    width: 56px;
  }
  .ref {
    flex-shrink: 0; font-size: 10px; line-height: 1.4; padding: 0 6px; border-radius: 9px;
    border: 1px solid color-mix(in srgb, var(--git-graph-accent) 50%, var(--border));
    color: var(--git-graph-accent);
    background: color-mix(in srgb, var(--git-graph-accent) 12%, transparent);
    white-space: nowrap;
  }
  .ref.head { border-color: var(--success); color: var(--success); background: color-mix(in srgb, var(--success) 14%, transparent); font-weight: 600; }
  .ref.tag { border-color: var(--warning); color: var(--warning); background: color-mix(in srgb, var(--warning) 14%, transparent); }
  .subject { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .author {
    color: var(--text-secondary); flex-shrink: 0; white-space: nowrap;
    max-width: 140px; overflow: hidden; text-overflow: ellipsis; font-size: 11px;
  }
  .date { color: var(--text-muted); flex-shrink: 0; white-space: nowrap; font-size: 11px; width: 64px; text-align: right; }
  .changes {
    display: flex; align-items: center; gap: 5px; flex-shrink: 0;
    font-family: var(--font-mono, monospace); font-size: 10.5px; min-width: 92px; justify-content: flex-end;
  }
  .files-count { display: inline-flex; align-items: center; gap: 2px; color: var(--text-muted); }
  .ins { color: var(--success); font-weight: 600; }
  .del { color: var(--error); font-weight: 600; }

  /* Commit detail panel */
  .detail {
    flex-shrink: 0;
    max-height: 45%;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border);
    background: var(--bg-secondary);
  }
  .detail-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px 4px; }
  .detail-sha {
    font-family: var(--font-mono, monospace); font-size: 10.5px;
    background: var(--bg-surface); color: var(--text-muted);
    padding: 1px 6px; border-radius: 4px; flex-shrink: 0;
  }
  .detail-subject { flex: 1; font-size: 12.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .detail-close {
    flex-shrink: 0; color: var(--text-muted); cursor: pointer;
    display: flex; align-items: center; padding: 2px; border-radius: 4px;
  }
  .detail-close:hover { background: var(--bg-surface); color: var(--text-primary); }
  .detail-meta {
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    padding: 0 12px 6px; font-size: 11px; color: var(--text-muted);
  }
  .detail-meta .dot { opacity: 0.5; }
  .detail-meta .email { color: var(--text-secondary); }
  .detail-actions { display: flex; gap: 6px; padding: 0 12px 8px; border-bottom: 1px solid var(--border); }
  .action-btn {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 11px; padding: 4px 8px; border-radius: 5px;
    background: var(--bg-surface); color: var(--text-secondary);
    border: 1px solid var(--border); cursor: pointer;
  }
  .action-btn:hover { background: var(--bg-tertiary); color: var(--text-primary); }

  .files { overflow-y: auto; min-height: 0; padding: 4px 8px 8px; }
  .files-loading { padding: 8px 6px; font-size: 11px; color: var(--text-muted); }
  .files-label {
    display: flex; align-items: center; gap: 6px;
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em;
    color: var(--text-muted); padding: 6px 6px 4px;
  }
  .files-badge { background: var(--bg-surface); border-radius: 4px; padding: 0 5px; font-size: 9.5px; }
  .file-row {
    display: flex; align-items: center; gap: 8px; width: 100%;
    padding: 4px 8px; border-radius: 5px; border: none; background: none;
    color: inherit; text-align: left; cursor: pointer; font-size: 11.5px;
  }
  .file-row:hover, .file-row.expanded { background: var(--bg-surface); }
  .file-name { font-weight: 500; flex-shrink: 0; max-width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-dir { flex: 1; color: var(--text-muted); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-stat { display: flex; gap: 5px; flex-shrink: 0; font-family: var(--font-mono, monospace); font-size: 10px; }
  .file-stat .bin { color: var(--text-muted); }
  .file-status { width: 16px; text-align: center; font-weight: 700; font-size: 9.5px; flex-shrink: 0; font-family: var(--font-mono, monospace); }
  .file-diff {
    max-height: 240px; overflow: auto;
    margin: 2px 4px 6px; border: 1px solid var(--border); border-radius: 6px;
    font-family: var(--font-mono, monospace); font-size: 11px; background: var(--bg-primary);
  }
  .diff-line { display: flex; white-space: pre; line-height: 1.5; padding: 0 6px; }
  .diff-line.add { background: color-mix(in srgb, var(--diff-add) 15%, transparent); color: var(--diff-add); }
  .diff-line.del { background: color-mix(in srgb, var(--diff-del) 15%, transparent); color: var(--diff-del); }
  .diff-line.ctx { color: var(--text-muted); }
  .diff-text { flex: 1; min-width: 0; }
</style>
