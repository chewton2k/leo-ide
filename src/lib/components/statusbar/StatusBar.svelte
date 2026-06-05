<script lang="ts">
  import { GitBranch, Bot } from 'lucide-svelte';
  import {
    gitBranch, activeFilePath, isTerminalPath, isPreviewPath, isGitGraphPath,
    editorCursor, languageLabel, formatCursor, branchLabel,
    agentTerminalStatus,
  } from '../../modules';

  const AGENT_LABELS = { working: 'Agent working…', attention: 'Agent needs you', finished: 'Agent done' };
  const isFileTab = $derived(
    !!$activeFilePath
    && !isTerminalPath($activeFilePath)
    && !isPreviewPath($activeFilePath)
    && !isGitGraphPath($activeFilePath)
  );
  const branch = $derived(branchLabel($gitBranch));
</script>

<div class="statusbar-info">
  {#if $agentTerminalStatus}
    <span class="sb-item sb-agent" class:attention={$agentTerminalStatus !== 'working'} title="AI agent in terminal">
      <Bot size={13} /> {AGENT_LABELS[$agentTerminalStatus]}
    </span>
  {/if}
  {#if branch}
    <span class="sb-item" title="Git branch"><GitBranch size={13} /> {branch}</span>
  {/if}
  {#if isFileTab && $editorCursor}
    <span class="sb-item">{formatCursor($editorCursor.line, $editorCursor.col)}</span>
  {/if}
  {#if isFileTab}
    <span class="sb-item">{languageLabel($activeFilePath)}</span>
  {/if}
</div>

<style>
  .statusbar-info {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .sb-item {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12.5px;
    color: var(--statusbar-text, var(--text-secondary));
    opacity: 0.9;
    white-space: nowrap;
  }
  .sb-agent.attention { opacity: 1; font-weight: 600; }
</style>
