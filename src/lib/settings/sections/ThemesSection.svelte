<script lang="ts">
  import { bgImageId, bgOpacity, bgBlur, BG_OPACITY_MAX, BG_BLUR_MAX, importBgImageFromFile, deleteBgImage,
    customThemes, activeCustomThemeId, saveCustomTheme, deleteCustomTheme,
    starterCustomTheme, copyThemeToCustom, emitThemeEdit, builtinThemeVars,
    appearanceMode, editorTheme, BUILTIN_THEMES, themeSwatches,
    type EditorThemeId } from '../../modules';
  import { Copy, Pencil, Trash2 } from 'lucide-svelte';

  function applyTheme(t: { id: EditorThemeId; light: boolean }) {
    editorTheme.set(t.id);
    appearanceMode.set(t.light ? 'light' : 'dark');
    activeCustomThemeId.set('');
  }
  function themeActive(id: EditorThemeId): boolean {
    return $activeCustomThemeId === '' && $editorTheme === id;
  }

  /**
   * Duplicate any theme (built-in or custom) into a new editable custom theme,
   * seeded from its variables, then activate it and open it in the editor.
   */
  function copyTheme(name: string, vars: Record<string, string> | null) {
    if (!vars) return;
    const t = copyThemeToCustom({ name, vars });
    saveCustomTheme(t);
    activeCustomThemeId.set(t.id);
    void emitThemeEdit({ id: t.id });
  }

  let fileInput: HTMLInputElement | undefined = $state();
  let error = $state('');
  let busy = $state(false);

  // Custom themes are edited as JSON tabs in the main editor (not here). The
  // settings window just creates/opens them; the main window opens the tab.
  function newTheme() {
    const t = starterCustomTheme();
    saveCustomTheme(t);
    activeCustomThemeId.set(t.id);
    void emitThemeEdit({ id: t.id });
  }

  function editTheme(id: string) {
    void emitThemeEdit({ id });
  }

  async function onPick(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    error = '';
    busy = true;
    try {
      const prev = $bgImageId;
      const { id } = await importBgImageFromFile(file);
      bgImageId.set(id);
      if (prev && prev !== id) deleteBgImage(prev).catch(() => {});
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
      if (fileInput) fileInput.value = '';
    }
  }

  function clearBackground() {
    const prev = $bgImageId;
    bgImageId.set('');
    if (prev) deleteBgImage(prev).catch(() => {});
  }
</script>

<div class="section">
  <h2 class="section-title">Themes</h2>

  <div class="group-label">Theme</div>
  <div class="theme-grid" data-setting="custom-theme">
    {#each BUILTIN_THEMES as b (b.id)}
      <div class="theme-card" class:active={themeActive(b.id)}>
        <button class="theme-card-apply" onclick={() => applyTheme(b)} title="Apply {b.name}">
          <div class="swatches">{#each b.swatches as c}<span style:background-color={c}></span>{/each}</div>
          <span class="theme-card-name">{b.name}</span>
        </button>
        <div class="card-actions">
          <button class="icon-btn" title="Create an editable copy" aria-label="Copy {b.name}" onclick={() => copyTheme(b.name, builtinThemeVars(b.id))}><Copy size={13} /></button>
        </div>
      </div>
    {/each}

    {#each $customThemes as theme (theme.id)}
      <div class="theme-card" class:active={$activeCustomThemeId === theme.id}>
        <button class="theme-card-apply" onclick={() => activeCustomThemeId.set(theme.id)} title="Apply {theme.name}">
          <div class="swatches">{#each themeSwatches(theme.vars) as c}<span style:background-color={c}></span>{/each}</div>
          <span class="theme-card-name">{theme.name}</span>
        </button>
        <div class="card-actions">
          <button class="icon-btn" title="Edit" aria-label="Edit {theme.name}" onclick={() => editTheme(theme.id)}><Pencil size={13} /></button>
          <button class="icon-btn" title="Create an editable copy" aria-label="Copy {theme.name}" onclick={() => copyTheme(theme.name, theme.vars)}><Copy size={13} /></button>
          <button class="icon-btn danger" title="Delete" aria-label="Delete {theme.name}" onclick={() => deleteCustomTheme(theme.id)}><Trash2 size={13} /></button>
        </div>
      </div>
    {/each}

    <button class="theme-card new" onclick={newTheme}>+ New theme</button>
  </div>

  <div class="group-label">Background</div>

  <div class="row" data-setting="background-image">
    <div class="row-text">
      <div class="row-label">Background image</div>
      <div class="row-desc">Use an image or GIF as a subtle overlay across the app.</div>
    </div>
    <div class="row-control">
      <input bind:this={fileInput} type="file" accept="image/*" onchange={onPick} hidden />
      <button class="btn" disabled={busy} onclick={() => fileInput?.click()}>
        {busy ? 'Importing…' : $bgImageId ? 'Replace…' : 'Choose image…'}
      </button>
      {#if $bgImageId}
        <button class="btn ghost" onclick={clearBackground}>Clear</button>
      {/if}
    </div>
  </div>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  <div class="row" data-setting="background-opacity">
    <div class="row-text">
      <div class="row-label">Opacity</div>
      <div class="row-desc">How strongly the background shows through ({$bgOpacity}%).</div>
    </div>
    <div class="row-control">
      <input type="range" min="0" max={BG_OPACITY_MAX} step="1" bind:value={$bgOpacity} disabled={!$bgImageId} />
    </div>
  </div>

  <div class="row" data-setting="background-blur">
    <div class="row-text">
      <div class="row-label">Blur</div>
      <div class="row-desc">Blur radius for static images ({$bgBlur}px). Animated images are not blurred.</div>
    </div>
    <div class="row-control">
      <input type="range" min="0" max={BG_BLUR_MAX} step="1" bind:value={$bgBlur} disabled={!$bgImageId} />
    </div>
  </div>
</div>

<style>
  .section { display: flex; flex-direction: column; gap: 4px; }
  .section-title { font-family: var(--font-display); font-size: 18px; font-weight: 600; margin: 0 0 8px; color: var(--text-primary); }
  .group-label {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--text-muted); margin: 14px 0 6px;
  }
  .row {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 10px 0; border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  }
  .row-label { font-size: 13px; color: var(--text-primary); }
  .row-desc { font-size: 11.5px; color: var(--text-muted); margin-top: 2px; }
  .row-control { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .btn {
    padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer;
    background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border);
  }
  .btn:hover:not(:disabled) { border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); }
  .btn:disabled { opacity: 0.6; cursor: default; }
  .btn.ghost { background: none; color: var(--text-muted); }
  .error { color: var(--error); font-size: 12px; padding: 6px 0; }
  input[type="range"] { width: 160px; accent-color: var(--settings-icon, #B34B3C); }
  .theme-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin: 6px 0 4px; }
  .theme-card {
    position: relative; display: flex; flex-direction: column;
    padding: 0; overflow: hidden; border: 1px solid var(--border); border-radius: 8px;
    background: var(--bg-surface); text-align: left; color: var(--text-primary);
  }
  .theme-card:hover { border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); }
  .theme-card.active { border-color: var(--settings-icon, #B34B3C); box-shadow: 0 0 0 1px var(--settings-icon, #B34B3C); }
  .theme-card-apply {
    display: flex; flex-direction: column; gap: 8px; width: 100%;
    padding: 10px 10px 8px; background: none; border: none; cursor: pointer; text-align: left; color: inherit;
  }
  .theme-card.new { align-items: center; justify-content: center; padding: 10px; cursor: pointer; color: var(--text-muted); border-style: dashed; min-height: 78px; }
  .theme-card-name { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .swatches { display: flex; gap: 0; height: 18px; border-radius: 4px; overflow: hidden; }
  .swatches span { flex: 1; display: block; }
  /* Always-visible footer of icon actions (Copy on built-ins; Edit/Copy/Delete on custom). */
  .card-actions {
    display: flex; justify-content: flex-end; gap: 2px;
    padding: 0 6px 6px;
  }
  .icon-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 22px; border-radius: 5px; cursor: pointer;
    background: none; color: var(--text-muted); border: 1px solid transparent;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }
  .icon-btn:hover { background: var(--bg-secondary); color: var(--text-primary); border-color: var(--border); }
  .icon-btn.danger:hover { color: var(--error); border-color: color-mix(in srgb, var(--error) 55%, var(--border)); }
</style>
