import { describe, expect, it } from 'vitest';
import { cwdBreadcrumbSegments } from '../../../src/lib/modules/layout/breadcrumb';

describe('cwdBreadcrumbSegments (cwd breadcrumb)', () => {
  it('collapses the home prefix to ~ and carries absolute paths', () => {
    expect(cwdBreadcrumbSegments('/Users/me/projects/leo', '/Users/me')).toEqual([
      { name: '~', path: '/Users/me' },
      { name: 'projects', path: '/Users/me/projects' },
      { name: 'leo', path: '/Users/me/projects/leo' },
    ]);
  });

  it('shows just ~ when cwd equals home', () => {
    expect(cwdBreadcrumbSegments('/Users/me', '/Users/me')).toEqual([
      { name: '~', path: '/Users/me' },
    ]);
  });

  it('uses / root when cwd is outside home', () => {
    expect(cwdBreadcrumbSegments('/var/log', '/Users/me')).toEqual([
      { name: '/', path: '/' },
      { name: 'var', path: '/var' },
      { name: 'log', path: '/var/log' },
    ]);
  });

  it('handles a Windows drive root', () => {
    expect(cwdBreadcrumbSegments('C:\\Users\\me\\proj', null)).toEqual([
      { name: 'C:', path: 'C:/' },
      { name: 'Users', path: 'C:/Users' },
      { name: 'me', path: 'C:/Users/me' },
      { name: 'proj', path: 'C:/Users/me/proj' },
    ]);
  });

  it('returns [] when there is no cwd', () => {
    expect(cwdBreadcrumbSegments(null, '/Users/me')).toEqual([]);
  });
});
