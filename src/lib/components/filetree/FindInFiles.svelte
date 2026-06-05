<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { get } from 'svelte/store';
  import { Search, CaseSensitive } from 'lucide-svelte';
  import { projectRoot, addFile, editorGotoTarget } from '../../modules';

  interface GrepHit { path: string; rel: string; line: number; text: string; }
  interface FileGroup { rel: string; path: string; hits: GrepHit[]; }

  let pattern = $state('');
  let glob = $state('');
  let caseInsensitive = $state(true);
  let groups = $state<FileGroup[]>([]);
  let truncated = $state(false);
  let loading = $state(false);
  let searched = $state(false);
  let error = $state('');
  let debounce: ReturnType<typeof setTimeout> | null = null;

  async function run() {
    const root = get(projectRoot);
    if (!root || !pattern.trim()) { groups = []; searched = false; return; }
    loading = true;
    error = '';
    try {
      const res = await invoke<{ hits: GrepHit[]; truncated: boolean }>('fs_grep', {
        pattern,
        root,
        glob: glob.trim() ? [glob.trim()] : null,
        caseInsensitive: caseInsensitive ? true : null,
        maxResults: 500,
      });
      const byFile = new Map<string, FileGroup>();
      for (const h of res.hits) {
        let g = byFile.get(h.rel);
        if (!g) { g = { rel: h.rel, path: h.path, hits: [] }; byFile.set(h.rel, g); }
        g.hits.push(h);
      }
      groups = [...byFile.values()];
      truncated = res.truncated;
    } catch (e) {
      error = String(e);
      groups = [];
    }
    loading = false;
    searched = true;
  }

  function onInput() {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(run, 250);
  }

  function openHit(g: FileGroup, hit: GrepHit) {
    addFile(g.path, g.rel.split('/').pop() ?? g.rel);
    editorGotoTarget.set({ path: g.path, line: hit.line });
  }

  const totalHits = $derived(groups.reduce((n, g) => n + g.hits.length, 0));
</script>

<div class="fif">
  <div class="fif-controls">
    <div class="fif-input-row">
      <Search size={13} class="fif-search-icon" />
      <input
        class="fif-input"
        placeholder="Search in files…"
        bind:value={pattern}
        oninput={onInput}
        onkeydown={(e) => e.key === 'Enter' && run()}
      />
      <button
        class="fif-toggle"
        class:active={!caseInsensitive}
        title={caseInsensitive ? 'Case-insensitive' : 'Case-sensitive'}
        onclick={() => { caseInsensitive = !caseInsensitive; run(); }}
      >
        <CaseSensitive size={14} />
      </button>
    </div>
    <input class="fif-glob" placeholder="files to include (glob, e.g. *.ts)" bind:value={glob} oninput={onInput} />
  </div>

  <div class="fif-results">
    {#if loading}
      <div class="fif-empty">Searching…</div>
    {:else if error}
      <div class="fif-empty fif-error">{error}</div>
    {:else if searched && groups.length === 0}
      <div class="fif-empty">No results.</div>
    {:else if groups.length > 0}
      <div class="fif-summary">{totalHits} result{totalHits === 1 ? '' : 's'} in {groups.length} file{groups.length === 1 ? '' : 's'}{truncated ? ' (truncated)' : ''}</div>
      {#each groups as g (g.rel)}
        <div class="fif-file">{g.rel}</div>
        {#each g.hits as hit}
          <button class="fif-hit" onclick={() => openHit(g, hit)} title={g.rel + ':' + hit.line}>
            <span class="fif-line">{hit.line}</span>
            <span class="fif-text">{hit.text.trim()}</span>
          </button>
        {/each}
      {/each}
    {/if}
  </div>
</div>

<style>
  .fif { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .fif-controls { padding: 8px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 6px; }
  .fif-input-row { display: flex; align-items: center; gap: 6px; }
  :global(.fif-search-icon) { color: var(--text-muted); flex-shrink: 0; }
  .fif-input, .fif-glob {
    flex: 1; min-width: 0; background: var(--bg-surface); color: var(--text-primary);
    border: 1px solid var(--border); border-radius: 6px; padding: 5px 8px; font-size: 12px;
  }
  .fif-glob { font-size: 11px; }
  .fif-input:focus, .fif-glob:focus { outline: none; border-color: var(--settings-icon, #B34B3C); }
  .fif-toggle {
    display: flex; align-items: center; justify-content: center; width: 26px; height: 26px;
    border-radius: 5px; color: var(--text-muted); flex-shrink: 0; cursor: pointer;
  }
  .fif-toggle:hover { background: var(--bg-surface); color: var(--text-primary); }
  .fif-toggle.active { background: var(--bg-surface); color: var(--settings-icon, #B34B3C); }
  .fif-results { flex: 1; overflow-y: auto; padding: 4px 0; }
  .fif-empty { padding: 16px; color: var(--text-muted); font-size: 12px; }
  .fif-error { color: var(--error); }
  .fif-summary { padding: 4px 10px; color: var(--text-muted); font-size: 11px; }
  .fif-file { padding: 4px 10px; font-size: 11px; font-weight: 600; color: var(--text-secondary); position: sticky; top: 0; background: var(--bg-primary); }
  .fif-hit {
    display: flex; gap: 8px; width: 100%; text-align: left; padding: 3px 10px 3px 18px;
    font-size: 12px; color: var(--text-secondary); cursor: pointer;
  }
  .fif-hit:hover { background: color-mix(in srgb, var(--bg-surface) 80%, transparent); color: var(--text-primary); }
  .fif-line { color: var(--text-muted); flex-shrink: 0; min-width: 30px; text-align: right; font-family: var(--font-mono, monospace); }
  .fif-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono, monospace); }
</style>
