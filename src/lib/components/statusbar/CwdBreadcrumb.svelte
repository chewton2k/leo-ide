<script lang="ts">
  /**
   *
   * Parent segments are clickable → `onCd(path)` (cd up/across). The current
   * (last) segment is a dropdown: opening it lists the cwd's subdirectories so
   * the user can pick where to cd next. Subdirs are loaded lazily via the
   * existing `read_dir_tree` backend command (depth 1, dirs only).
   */
  import { invoke } from '@tauri-apps/api/core';
  import { portal } from '../../modules/ui';
  import type { BreadcrumbSegment } from '../../modules/layout/breadcrumb';

  interface Props {
    segments: BreadcrumbSegment[];
    onCd: (path: string) => void;
  }
  let { segments, onCd }: Props = $props();

  const parents = $derived(segments.slice(0, -1));
  const current = $derived(segments[segments.length - 1]);

  let menuOpen = $state(false);
  let menuPos = $state<{ left: number; bottom: number } | null>(null);
  let triggerEl = $state<HTMLButtonElement>();
  let subdirs = $state<string[] | null>(null);
  let failed = $state(false);

  function joinPath(base: string, name: string): string {
    return base.endsWith('/') ? base + name : base + '/' + name;
  }

  async function toggleMenu() {
    if (menuOpen) { menuOpen = false; return; }
    const rect = triggerEl?.getBoundingClientRect();
    if (rect) menuPos = { left: rect.left, bottom: window.innerHeight - rect.top + 4 };
    menuOpen = true;
    subdirs = null;
    failed = false;
    try {
      const entries = await invoke<{ name: string; is_dir: boolean }[]>('read_dir_tree', { path: current.path, depth: 1 });
      subdirs = entries.filter(e => e.is_dir).map(e => e.name).sort((a, b) => a.localeCompare(b));
    } catch {
      failed = true;
      subdirs = [];
    }
  }

  function pick(name: string) {
    onCd(joinPath(current.path, name));
    menuOpen = false;
  }

  function handleDocMouseDown(e: MouseEvent) {
    if (!menuOpen) return;
    const t = e.target as Node;
    if (triggerEl?.contains(t)) return;
    if ((t as Element)?.closest?.('.cwd-menu')) return;
    menuOpen = false;
  }
</script>

<svelte:document onmousedown={handleDocMouseDown} />

<div class="breadcrumb">
  {#each parents as seg, i}
    <button class="seg" onclick={() => onCd(seg.path)} title={`cd ${seg.path}`}>
      {#if i === 0}<span class="dot"></span>{/if}
      {seg.name}
    </button>
    <span class="sep">›</span>
  {/each}
  {#if current}
    <button
      class="seg current"
      class:open={menuOpen}
      bind:this={triggerEl}
      onclick={toggleMenu}
      title="Go to a subfolder"
      aria-haspopup="menu"
      aria-expanded={menuOpen}
    >
      {#if parents.length === 0}<span class="dot"></span>{/if}
      {current.name}
      <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><path d="M6 9l6 6 6-6" /></svg>
    </button>
  {/if}
</div>

{#if menuOpen && menuPos}
  <div class="cwd-menu" use:portal role="menu" style="left:{menuPos.left}px; bottom:{menuPos.bottom}px;">
    {#if subdirs === null}
      <div class="cwd-msg">Loading…</div>
    {:else if subdirs.length === 0}
      <div class="cwd-msg">{failed ? 'Cannot read folder' : 'No subfolders'}</div>
    {:else}
      {#each subdirs as name}
        <button class="cwd-item" role="menuitem" onclick={() => pick(name)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
          <span class="cwd-item-name">{name}</span>
        </button>
      {/each}
    {/if}
  </div>
{/if}

<style>
  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 13px;
    min-width: 0;
    overflow: hidden;
    padding-left: 8px;
  }

  .seg {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 4px;
    border: none;
    background: none;
    border-radius: 4px;
    white-space: nowrap;
    font-size: 13px;
    font-family: inherit;
    color: inherit;
    cursor: pointer;
    transition: opacity 0.1s, background 0.1s;
  }
  .seg:hover { opacity: 0.75; }
  .seg.current { font-weight: 500; }
  .seg.current:hover,
  .seg.current.open {
    opacity: 1;
    background: color-mix(in srgb, currentColor 12%, transparent);
  }

  .dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.7;
    flex-shrink: 0;
  }
  .sep {
    opacity: 0.75;
    font-size: 12.5px;
    font-weight: 600;
    flex-shrink: 0;
    color: inherit;
  }
  .chev { opacity: 0.6; flex-shrink: 0; }

  .cwd-menu {
    position: fixed;
    z-index: 300;
    min-width: 180px;
    max-width: 320px;
    max-height: 320px;
    overflow-y: auto;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
    padding: 4px;
  }
  .cwd-msg {
    padding: 7px 10px;
    font-size: 11px;
    color: var(--text-muted);
  }
  .cwd-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 9px;
    background: none;
    border: none;
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 12px;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
  }
  .cwd-item:hover { background: var(--bg-surface); }
  .cwd-item svg { color: var(--text-muted); flex-shrink: 0; }
  .cwd-item-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
