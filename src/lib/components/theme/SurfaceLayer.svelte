<script lang="ts">
  import { bgImageId, bgOpacity, bgBlur, getBgImage } from '../../modules';

  let url = $state<string | null>(null);
  let animated = $state(false);
  let lastUrl: string | null = null;

  function revoke() {
    if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = null; }
  }

  // Load (or clear) the image blob whenever the selected id changes.
  $effect(() => {
    const id = $bgImageId;
    if (!id) { revoke(); url = null; return; }
    let alive = true;
    getBgImage(id).then((blob) => {
      if (!alive || !blob) { if (alive) { revoke(); url = null; } return; }
      revoke();
      const next = URL.createObjectURL(blob);
      lastUrl = next;
      url = next;
      const t = blob.type.toLowerCase();
      animated = t === 'image/gif' || t === 'image/apng' || t === 'image/webp';
    }).catch(() => { url = null; });
    return () => { alive = false; };
  });

  $effect(() => () => revoke());

  const opacity = $derived(Math.max(0, Math.min(50, $bgOpacity)) / 100);
  const blurPx = $derived(animated ? 0 : Math.max(0, Math.min(40, $bgBlur)));
</script>

{#if url}
  <div
    class="bg-surface"
    aria-hidden="true"
    style:background-image={`url(${url})`}
    style:opacity={opacity}
    style:filter={blurPx > 0 ? `blur(${blurPx}px)` : 'none'}
  ></div>
{/if}

<style>
  .bg-surface {
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    pointer-events: none;
    background-size: cover;
    background-position: center;
    transform: translateZ(0);
    transition: opacity 200ms ease-out;
  }
</style>
