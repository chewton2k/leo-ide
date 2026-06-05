import { describe, it, expect } from 'vitest';
import { slashQuery, filterSlashCommands, isVoiceSupported, SLASH_COMMANDS } from '../../../src/lib/modules/ai/composer';

describe('slashQuery', () => {
  it('returns the query for a bare slash command being typed', () => {
    expect(slashQuery('/cl')).toBe('cl');
    expect(slashQuery('/')).toBe('');
  });
  it('is null once a space is typed (it is now a message)', () => {
    expect(slashQuery('/clear the chat')).toBeNull();
  });
  it('is null for normal input', () => {
    expect(slashQuery('hello')).toBeNull();
    expect(slashQuery('')).toBeNull();
  });
});

describe('filterSlashCommands', () => {
  it('returns all for empty query', () => {
    expect(filterSlashCommands('')).toHaveLength(SLASH_COMMANDS.length);
  });
  it('filters by id/label substring', () => {
    expect(filterSlashCommands('cl').map(c => c.id)).toEqual(['clear']);
    expect(filterSlashCommands('att').map(c => c.id)).toEqual(['attach']);
  });
  it('tolerates a leading slash in the query', () => {
    expect(filterSlashCommands('/model').map(c => c.id)).toEqual(['model']);
  });
  it('returns nothing for no match', () => {
    expect(filterSlashCommands('zzz')).toEqual([]);
  });
});

describe('isVoiceSupported', () => {
  it('returns a boolean (false under jsdom without SpeechRecognition)', () => {
    expect(typeof isVoiceSupported()).toBe('boolean');
  });
});
