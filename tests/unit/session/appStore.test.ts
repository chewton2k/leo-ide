import { describe, it, expect } from 'vitest';
import { getStoreValue, setStoreValue, deleteStoreValue } from '../../../src/lib/modules/session/appStore';

describe('appStore (cross-process store helper)', () => {
  it('round-trips a value', async () => {
    await setStoreValue('alpha', 42);
    expect(await getStoreValue('alpha', 0)).toBe(42);
  });
  it('returns the fallback for a missing key', async () => {
    expect(await getStoreValue('missing-key', 'fb')).toBe('fb');
  });
  it('delete removes a value', async () => {
    await setStoreValue('beta', 'x');
    await deleteStoreValue('beta');
    expect(await getStoreValue('beta', null)).toBeNull();
  });
});
