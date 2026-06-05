<script lang="ts">
  import { filterActions, PALETTE_ACTIONS, PALETTE_GROUP_ORDER, type PaletteAction } from '../../modules';

  let { onClose, extraActions = [] as PaletteAction[] }: {
    onClose: () => void;
    extraActions?: PaletteAction[];
  } = $props();

  let query = $state('');
  let selectedIndex = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();
  let listEl: HTMLDivElement | undefined = $state();

  const all = $derived([...PALETTE_ACTIONS, ...extraActions]);
  const results = $derived(filterActions(query, all));

  // Ordered groups for display; `results` is already ranked, we just bucket it.
  const grouped = $derived(
    PALETTE_GROUP_ORDER
      .map(group => ({ group, items: results.filter(a => a.group === group) }))
      .filter(g => g.items.length > 0)
  );
  // Flat list in display order, for keyboard navigation + index mapping.
  const flat = $derived(grouped.flatMap(g => g.items));

  $effect(() => { results; selectedIndex = 0; });
  $effect(() => { requestAnimationFrame(() => inputEl?.focus()); });

  function runAt(i: number) {
    const action = flat[i];
    if (!action) return;
    onClose();
    action.run();
  }

  function scrollToSelected() {
    requestAnimationFrame(() => {
      listEl?.querySelector('.cmd-item.selected')?.scrollIntoView({ block: 'nearest' });
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, flat.length - 1);
      scrollToSelected();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      scrollToSelected();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runAt(selectedIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="search-overlay" onclick={onClose} onkeydown={handleKeydown}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="search-dialog" onclick={(e) => e.stopPropagation()}>
    <div class="search-input-row">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14">
        <path d="M2 4h12M2 8h12M2 12h7" stroke-linecap="round" />
      </svg>
      <input
        bind:this={inputEl}
        bind:value={query}
        class="search-input"
        placeholder="Type a command…"
        autocapitalize="off"
        autocomplete="off"
        spellcheck="false"
        onkeydown={handleKeydown}
      />
    </div>
    <div class="search-results" bind:this={listEl}>
      {#each grouped as g}
        <div class="cmd-group">{g.group}</div>
        {#each g.items as action}
          {@const idx = flat.indexOf(action)}
          <button
            class="cmd-item"
            class:selected={idx === selectedIndex}
            onclick={() => runAt(idx)}
            onmouseenter={() => (selectedIndex = idx)}
          >
            {action.label}
          </button>
        {/each}
      {/each}
      {#if flat.length === 0}
        <div class="no-results">No matching commands</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .search-overlay { position: fixed; inset: 0; z-index: 1000; }
  .search-dialog {
    position: fixed;
    top: var(--density-tabs-height, 36px);
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-top: none;
    border-radius: 0 0 8px 8px;
    width: 500px;
    max-height: 360px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
    overflow: hidden;
  }
  .search-input-row {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 14px; border-bottom: 1px solid var(--border); color: var(--text-muted);
  }
  .search-input {
    flex: 1; background: none; border: none; color: var(--text-primary);
    font-size: 13px; outline: none; font-family: var(--font-ui);
  }
  .search-input::placeholder { color: var(--text-muted); }
  .search-results { overflow-y: auto; max-height: 320px; padding: 4px 6px; }
  .cmd-group {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--text-muted); padding: 8px 10px 3px;
  }
  .cmd-item {
    display: flex; align-items: center; width: 100%;
    padding: 6px 10px; text-align: left; border: none; background: none;
    color: var(--text-primary); font-size: 13px; border-radius: 4px; cursor: pointer;
  }
  .cmd-item.selected { background: var(--bg-surface); }
  .no-results { padding: 20px 14px; text-align: center; color: var(--text-muted); font-size: 13px; }
</style>
