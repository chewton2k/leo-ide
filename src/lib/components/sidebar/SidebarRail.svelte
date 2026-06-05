<script lang="ts">
  import { FolderTree, GitBranch } from 'lucide-svelte';

  let { activeView, onSelect, changedCount = 0 }: {
    activeView: 'explorer' | 'git';
    onSelect: (v: 'explorer' | 'git') => void;
    changedCount?: number;
  } = $props();
</script>

<div class="sidebar-rail">
  <button
    class="rail-btn"
    class:active={activeView === 'explorer'}
    onclick={() => onSelect('explorer')}
    aria-pressed={activeView === 'explorer'}
    title="Files"
  >
    <FolderTree size={14} /> <span>Files</span>
  </button>
  <button
    class="rail-btn"
    class:active={activeView === 'git'}
    onclick={() => onSelect('git')}
    aria-pressed={activeView === 'git'}
    title="Source Control (⌘G)"
  >
    <GitBranch size={14} /> <span>Source Control</span>
    {#if changedCount > 0}<span class="badge">{changedCount > 99 ? '99+' : changedCount}</span>{/if}
  </button>
</div>

<style>
  .sidebar-rail {
    display: flex;
    align-items: stretch;
    gap: 4px;
    flex-shrink: 0;
    height: 34px;
    padding: 4px 6px;
    border-top: 1px solid var(--border);
    background: var(--bg-secondary);
  }
  .rail-btn {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border-radius: 6px;
    font-size: 10px;
    font-weight: 600;
    color: var(--text-muted);
    background: none;
    border: none;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .rail-btn:hover { background: var(--bg-surface); color: var(--text-primary); }
  .rail-btn.active { background: var(--bg-surface); color: var(--text-primary); }
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    font-size: 9px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    background: var(--accent);
    color: var(--bg-primary);
  }
</style>
