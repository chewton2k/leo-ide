/** Split a binding string into its chord sequence ("A B" -> ["A","B"]). */
export function splitChords(binding: string): string[] {
  return binding.split(/\s+/).filter(Boolean);
}

/** True when `seq` is a STRICT prefix (shorter) of `binding`'s chords. */
export function isPrefix(seq: string[], binding: string[]): boolean {
  if (seq.length >= binding.length) return false;
  return seq.every((chord, i) => chord === binding[i]);
}

export type ChordResult =
  | { status: 'none' }
  | { status: 'pending' }
  | { status: 'match'; id: string };

/**
 * Stateful multi-chord matcher. `feed(chord)` accumulates chords:
 * - exact match of a binding -> 'match' (and resets);
 * - strict prefix of some binding -> 'pending' (buffer held);
 * - anything else -> 'none' (and resets).
 * Single-chord bindings match immediately (no pending state).
 */
export function createChordMatcher(getBindings: () => Record<string, string>) {
  let buffer: string[] = [];
  const reset = () => { buffer = []; };
  return {
    reset,
    feed(chord: string): ChordResult {
      const seq = [...buffer, chord];
      const entries = Object.entries(getBindings());
      for (const [id, binding] of entries) {
        if (!binding) continue;
        const chords = splitChords(binding);
        if (chords.length === seq.length && chords.every((c, i) => c === seq[i])) {
          reset();
          return { status: 'match', id };
        }
      }
      const hasPrefix = entries.some(([, b]) => b && isPrefix(seq, splitChords(b)));
      if (hasPrefix) {
        buffer = seq;
        return { status: 'pending' };
      }
      reset();
      return { status: 'none' };
    },
  };
}
