<script lang="ts">
  import type { GraphRow } from '../../modules/git/graph';

  let { row, rowHeight = 28 }: { row: GraphRow; rowHeight?: number } = $props();

  const COL = 14;
  const R = 4;

  const laneX = (i: number) => i * COL + COL / 2;
  const mid = $derived(rowHeight / 2);
  const width = $derived(Math.max(row.laneCount, row.lane + 1) * COL);

  function topPath(fromLane: number, toLane: number): string {
    const fx = laneX(fromLane);
    const tx = laneX(toLane);
    return `M ${fx} 0 C ${fx} ${mid}, ${tx} 0, ${tx} ${mid}`;
  }
  function bottomPath(fromLane: number, toLane: number): string {
    const fx = laneX(fromLane);
    const tx = laneX(toLane);
    return `M ${fx} ${mid} C ${fx} ${rowHeight}, ${tx} ${mid}, ${tx} ${rowHeight}`;
  }
</script>

<svg class="rail" width={width} height={rowHeight} viewBox="0 0 {width} {rowHeight}">
  {#each row.topEdges as e}
    {#if e.kind === 'straight'}
      <line x1={laneX(e.lane)} y1="0" x2={laneX(e.lane)} y2={mid} stroke={e.color} stroke-width="1.5" />
    {:else if e.kind === 'merge'}
      <path d={topPath(e.fromLane, e.toLane)} fill="none" stroke={e.color} stroke-width="1.5" />
    {/if}
  {/each}
  {#each row.bottomEdges as e}
    {#if e.kind === 'straight'}
      <line x1={laneX(e.lane)} y1={mid} x2={laneX(e.lane)} y2={rowHeight} stroke={e.color} stroke-width="1.5" />
    {:else if e.kind === 'branch'}
      <path d={bottomPath(e.fromLane, e.toLane)} fill="none" stroke={e.color} stroke-width="1.5" />
    {/if}
  {/each}
  <circle cx={laneX(row.lane)} cy={mid} r={R} fill={row.nodeColor} stroke="var(--bg-primary, #000)" stroke-width="1" />
</svg>

<style>
  .rail {
    flex-shrink: 0;
    display: block;
  }
</style>
