import { describe, it, expect } from 'vitest';
import { previewUrl } from '../../../src/lib/modules/settings/settings';
import { buildSessionData } from '../../../src/lib/modules/session/session';

describe('buildSessionData preview_url', () => {
  it('captures the current preview URL', () => {
    previewUrl.set('http://localhost:4321');
    expect(buildSessionData().preview_url).toBe('http://localhost:4321');
  });
  it('is null when the preview URL is empty', () => {
    previewUrl.set('');
    expect(buildSessionData().preview_url).toBeNull();
  });
});
