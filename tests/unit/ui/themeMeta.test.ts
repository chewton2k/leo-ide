import { describe, it, expect } from 'vitest';
import { THEME_VARS, THEME_VAR_META } from '../../../src/lib/modules/theme/validateTheme';

describe('THEME_VAR_META', () => {
  it('has a label + group for every theme variable', () => {
    for (const v of THEME_VARS) {
      expect(THEME_VAR_META[v], `missing meta for ${v}`).toBeTruthy();
      expect(THEME_VAR_META[v].label.length).toBeGreaterThan(0);
      expect(THEME_VAR_META[v].group.length).toBeGreaterThan(0);
    }
  });
});
