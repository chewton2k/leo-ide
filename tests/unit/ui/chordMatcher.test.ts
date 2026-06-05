import { describe, it, expect } from 'vitest';
import { splitChords, isPrefix, createChordMatcher } from '../../../src/lib/modules/shortcuts/chordMatcher';

describe('splitChords', () => {
  it('splits a multi-chord binding on spaces', () => {
    expect(splitChords('Meta+KeyK Meta+KeyS')).toEqual(['Meta+KeyK', 'Meta+KeyS']);
  });
  it('treats a single chord as a length-1 sequence', () => {
    expect(splitChords('Meta+KeyO')).toEqual(['Meta+KeyO']);
  });
  it('is empty for an empty/blank binding', () => {
    expect(splitChords('')).toEqual([]);
    expect(splitChords('   ')).toEqual([]);
  });
});

describe('isPrefix', () => {
  it('is true when seq is a strict prefix of binding chords', () => {
    expect(isPrefix(['Meta+KeyK'], ['Meta+KeyK', 'Meta+KeyS'])).toBe(true);
  });
  it('is false for a full match (prefix must be strictly shorter)', () => {
    expect(isPrefix(['Meta+KeyK', 'Meta+KeyS'], ['Meta+KeyK', 'Meta+KeyS'])).toBe(false);
  });
  it('is false when a chord differs', () => {
    expect(isPrefix(['Meta+KeyK'], ['Meta+KeyX', 'Meta+KeyS'])).toBe(false);
  });
});

describe('createChordMatcher', () => {
  const bindings = () => ({
    save: 'Meta+KeyS',
    chordA: 'Meta+KeyK Meta+KeyA',
    chordB: 'Meta+KeyK Meta+KeyB',
  });

  it('matches a single-chord binding immediately', () => {
    const m = createChordMatcher(bindings);
    expect(m.feed('Meta+KeyS')).toEqual({ status: 'match', id: 'save' });
  });

  it('holds pending on a chord that is a prefix, then matches on completion', () => {
    const m = createChordMatcher(bindings);
    expect(m.feed('Meta+KeyK')).toEqual({ status: 'pending' });
    expect(m.feed('Meta+KeyB')).toEqual({ status: 'match', id: 'chordB' });
  });

  it('resets to none on a non-matching continuation', () => {
    const m = createChordMatcher(bindings);
    expect(m.feed('Meta+KeyK')).toEqual({ status: 'pending' });
    expect(m.feed('Meta+KeyZ')).toEqual({ status: 'none' });
    // after reset, a fresh single-chord match works
    expect(m.feed('Meta+KeyS')).toEqual({ status: 'match', id: 'save' });
  });

  it('returns none for a chord that begins no binding', () => {
    const m = createChordMatcher(bindings);
    expect(m.feed('Alt+KeyQ')).toEqual({ status: 'none' });
  });

  it('reset() clears a pending sequence', () => {
    const m = createChordMatcher(bindings);
    m.feed('Meta+KeyK');
    m.reset();
    expect(m.feed('Meta+KeyA')).toEqual({ status: 'none' });
  });
});
