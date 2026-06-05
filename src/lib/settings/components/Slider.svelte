<script lang="ts">
  /**
     A native
   * range input gives keyboard + drag + a11y for free; the track is painted
   * with a filled portion up to the current value via a `--pct` gradient.
   */
  interface Props {
    value: number;
    min?: number;
    max?: number;
    step?: number;
    ariaLabel?: string;
    onChange: (value: number) => void;
  }
  let { value, min = 0, max = 100, step = 1, ariaLabel, onChange }: Props = $props();

  const pct = $derived(`${((value - min) / (max - min)) * 100}%`);
</script>

<input
  class="slider"
  type="range"
  {min}
  {max}
  {step}
  {value}
  aria-label={ariaLabel}
  style:--pct={pct}
  oninput={(e) => onChange(Number((e.currentTarget as HTMLInputElement).value))}
/>

<style>
  .slider {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 18px;
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
  }

  .slider::-webkit-slider-runnable-track {
    height: 6px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: linear-gradient(
      to right,
      var(--settings-icon, #b34b3c) var(--pct),
      var(--bg-surface) var(--pct)
    );
  }

  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    margin-top: -6px;
    border-radius: 50%;
    background: #fff;
    border: 1px solid var(--border);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    transition: box-shadow 0.12s;
  }

  .slider:hover::-webkit-slider-thumb {
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--settings-icon, #b34b3c) 25%, transparent);
  }

  .slider:focus-visible {
    outline: none;
  }
  .slider:focus-visible::-webkit-slider-thumb {
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 40%, transparent);
  }
</style>
