<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { get } from 'svelte/store';
  import { Palette } from 'lucide-svelte';
  import {
    customThemes, saveCustomTheme, activeCustomThemeId,
    parseTheme, validateThemeObject, paletteFromSeed,
    THEME_VARS, THEME_VAR_META,
    type CustomTheme,
  } from '../../modules';

  let { themeId }: { themeId: string } = $props();

  // ── Source of truth: name + vars (every themeable var present so you can
  //    customize all of them). Seeded from the saved theme, merged over a
  //    full default palette so no row is ever blank. ──
  const DEFAULTS = paletteFromSeed({
    bg: '#1a1b26', bg2: '#16161e', bg3: '#13131a', surface: '#1f2335',
    text: '#c0caf5', text2: '#a9b1d6', muted: '#565f89',
    accent: '#7aa2f7', border: '#29304d',
    success: '#9ece6a', warning: '#e0af68', error: '#f7768e',
  });
  const { initialName, initialVars } = untrack(() => {
    const existing = get(customThemes).find(t => t.id === themeId);
    return {
      initialName: existing?.name ?? themeId,
      initialVars: { ...DEFAULTS, ...(existing?.vars ?? {}) } as Record<string, string>,
    };
  });

  let name = $state(initialName);
  let vars = $state<Record<string, string>>(initialVars);
  let mode = $state<'visual' | 'json'>('visual');
  let jsonText = $state('');
  let error = $state('');
  let status = $state('');
  let commitTimer: ReturnType<typeof setTimeout> | undefined;

  // Groups in first-seen order across THEME_VARS, each with its vars (in order).
  const groups = (() => {
    const order: string[] = [];
    const byGroup = new Map<string, string[]>();
    for (const key of THEME_VARS) {
      const meta = THEME_VAR_META[key];
      if (!meta) continue;
      if (!byGroup.has(meta.group)) { byGroup.set(meta.group, []); order.push(meta.group); }
      byGroup.get(meta.group)!.push(key);
    }
    return order.map(g => ({ group: g, keys: byGroup.get(g)! }));
  })();

  const HEX_RE = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  function toHex6(v: string): string {
    if (!HEX_RE.test(v)) return '#000000';
    const h = v.slice(1);
    if (h.length === 3 || h.length === 4) return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
    return `#${h.slice(0, 6)}`;
  }

  /** Persist + live-apply the current theme (debounced). Invalid values surface
   *  an inline error and are not applied. */
  function commit() {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(() => {
      const theme: CustomTheme = { id: themeId, name: name.trim() || themeId, vars: { ...vars } };
      const res = validateThemeObject(theme);
      if (!res.ok) { error = res.error; status = ''; return; }
      error = '';
      saveCustomTheme(res.theme);
      activeCustomThemeId.set(themeId);
      status = 'Applied';
    }, 200);
  }

  function setVar(key: string, value: string) {
    vars = { ...vars, [key]: value };
    commit();
  }

  function setName(value: string) { name = value; commit(); }

  // ── JSON mode sync ──
  function syncToJson() {
    jsonText = JSON.stringify({ id: themeId, name: name.trim() || themeId, vars }, null, 2);
  }
  function applyJson() {
    const res = parseTheme(jsonText);
    if (!res.ok) { error = res.error; status = ''; return; }
    error = '';
    name = res.theme.name;
    vars = { ...DEFAULTS, ...res.theme.vars };
    saveCustomTheme(res.theme);
    activeCustomThemeId.set(themeId);
    status = 'Applied';
  }
  function onJsonInput() {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(applyJson, 250);
  }

  function setMode(next: 'visual' | 'json') {
    if (next === 'json') syncToJson();
    mode = next;
  }

  onDestroy(() => clearTimeout(commitTimer));
</script>

<div class="theme-editor">
  <div class="te-header">
    <div class="te-title">
      <Palette size={14} />
      <input class="te-name" value={name} oninput={(e) => setName((e.currentTarget as HTMLInputElement).value)} spellcheck="false" aria-label="Theme name" />
      <span class="te-live" title="Edits apply to the whole app as you type">Live</span>
    </div>
    <div class="te-actions">
      {#if error}<span class="te-error" title={error}>{error}</span>{:else if status}<span class="te-status">{status}</span>{/if}
      <div class="te-modes">
        <button class="te-mode" class:active={mode === 'visual'} onclick={() => setMode('visual')}>Visual</button>
        <button class="te-mode" class:active={mode === 'json'} onclick={() => setMode('json')}>JSON</button>
      </div>
    </div>
  </div>

  {#if mode === 'visual'}
    <div class="te-body visual">
      {#each groups as g (g.group)}
        <div class="cv-group-head">{g.group}</div>
        {#each g.keys as key (key)}
          <div class="cv-row">
            <span class="cv-label">{THEME_VAR_META[key].label}</span>
            <span class="cv-var">{key}</span>
            <label class="cv-chip" style:background-color={vars[key]} title={vars[key]}>
              <input
                type="color"
                value={toHex6(vars[key])}
                oninput={(e) => setVar(key, (e.currentTarget as HTMLInputElement).value)}
                aria-label={`${THEME_VAR_META[key].label} color`}
              />
            </label>
            <input
              class="cv-text"
              value={vars[key]}
              oninput={(e) => setVar(key, (e.currentTarget as HTMLInputElement).value)}
              spellcheck="false"
              autocapitalize="off"
              autocomplete="off"
            />
          </div>
        {/each}
      {/each}
    </div>
  {:else}
    <div class="te-body json">
      <textarea
        class="te-json"
        bind:value={jsonText}
        oninput={onJsonInput}
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
      ></textarea>
    </div>
  {/if}
</div>

<style>
  .theme-editor { display: flex; flex-direction: column; height: 100%; width: 100%; background: var(--bg-primary); }
  .te-header {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 6px 12px; border-bottom: 1px solid var(--border); flex-shrink: 0;
  }
  .te-title { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
  .te-name {
    font-size: 12.5px; font-weight: 600; color: var(--text-primary);
    background: transparent; border: 1px solid transparent; border-radius: 5px;
    padding: 3px 6px; outline: none; min-width: 0; max-width: 240px;
  }
  .te-name:hover { border-color: var(--border); }
  .te-name:focus { border-color: var(--accent); background: var(--bg-secondary); }
  .te-live {
    font-size: 9.5px; font-weight: 600; letter-spacing: 0.4px; text-transform: uppercase;
    color: var(--success);
    background: color-mix(in srgb, var(--success) 16%, transparent);
    border: 1px solid color-mix(in srgb, var(--success) 35%, transparent);
    padding: 1px 6px; border-radius: 8px; flex-shrink: 0;
  }
  .te-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  .te-error { font-size: 11px; color: var(--error); max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .te-status { font-size: 11px; color: var(--success); }
  .te-modes { display: flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
  .te-mode {
    padding: 4px 12px; font-size: 11.5px; font-weight: 600; cursor: pointer;
    background: var(--bg-secondary); color: var(--text-muted); border: none; border-right: 1px solid var(--border);
  }
  .te-mode:last-child { border-right: none; }
  .te-mode:hover { color: var(--text-primary); }
  .te-mode.active { background: var(--accent); color: var(--bg-primary); }

  .te-body { flex: 1; min-height: 0; overflow: auto; }

  .visual { padding: 8px 12px 24px; }
  .cv-group-head {
    font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px;
    color: var(--text-muted); margin: 14px 0 4px;
  }
  .cv-row {
    display: flex; align-items: center; gap: 10px;
    padding: 5px 0; border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  }
  .cv-label { font-size: 12px; color: var(--text-primary); width: 150px; flex-shrink: 0; }
  .cv-var {
    font-family: var(--font-mono); font-size: 10.5px; color: var(--text-muted);
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .cv-chip {
    position: relative; width: 22px; height: 22px; flex-shrink: 0;
    border-radius: 5px; cursor: pointer;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.55);
  }
  .cv-chip input[type="color"] {
    position: absolute; inset: 0; width: 100%; height: 100%;
    opacity: 0; border: none; padding: 0; margin: 0; background: transparent; cursor: pointer;
  }
  .cv-text {
    width: 150px; flex-shrink: 0;
    font-family: var(--font-mono); font-size: 11.5px;
    padding: 4px 8px; border-radius: 5px;
    background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border); outline: none;
  }
  .cv-text:focus { border-color: var(--accent); }

  .json { padding: 0; }
  .te-json {
    width: 100%; height: 100%; resize: none; border: none; outline: none;
    padding: 12px; box-sizing: border-box;
    background: var(--bg-primary); color: var(--text-primary);
    font-family: var(--font-mono, monospace); font-size: 13px; line-height: 1.5;
    tab-size: 2;
  }
</style>
