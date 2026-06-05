import { describe, it, expect } from 'vitest';
import { parseRemoteWebUrl, commitWebUrl, hostLabel } from '../../../src/lib/modules/git/remoteWebUrl';

describe('parseRemoteWebUrl', () => {
  it('parses https GitHub urls', () => {
    const info = parseRemoteWebUrl('https://github.com/owner/repo.git');
    expect(info).toMatchObject({ host: 'github', owner: 'owner', repo: 'repo', baseUrl: 'https://github.com/owner/repo' });
  });

  it('parses scp-style git@ urls', () => {
    const info = parseRemoteWebUrl('git@github.com:owner/repo.git');
    expect(info).toMatchObject({ host: 'github', owner: 'owner', repo: 'repo' });
  });

  it('parses gitlab and bitbucket', () => {
    expect(parseRemoteWebUrl('https://gitlab.com/o/r')?.host).toBe('gitlab');
    expect(parseRemoteWebUrl('git@bitbucket.org:o/r.git')?.host).toBe('bitbucket');
  });

  it('returns null for unsupported or malformed urls', () => {
    expect(parseRemoteWebUrl('https://example.com/o/r')).toBeNull();
    expect(parseRemoteWebUrl('https://github.com/onlyowner')).toBeNull();
    expect(parseRemoteWebUrl('')).toBeNull();
    expect(parseRemoteWebUrl(null)).toBeNull();
  });
});

describe('commitWebUrl', () => {
  const gh = parseRemoteWebUrl('https://github.com/o/r')!;
  const gl = parseRemoteWebUrl('https://gitlab.com/o/r')!;
  const bb = parseRemoteWebUrl('https://bitbucket.org/o/r')!;
  it('builds host-specific commit urls', () => {
    expect(commitWebUrl(gh, 'abc')).toBe('https://github.com/o/r/commit/abc');
    expect(commitWebUrl(gl, 'abc')).toBe('https://gitlab.com/o/r/-/commit/abc');
    expect(commitWebUrl(bb, 'abc')).toBe('https://bitbucket.org/o/r/commits/abc');
  });
});

describe('hostLabel', () => {
  it('labels each host', () => {
    expect(hostLabel(parseRemoteWebUrl('https://github.com/o/r')!)).toBe('View on GitHub');
    expect(hostLabel(parseRemoteWebUrl('https://gitlab.com/o/r')!)).toBe('View on GitLab');
    expect(hostLabel(parseRemoteWebUrl('https://bitbucket.org/o/r')!)).toBe('View on Bitbucket');
  });
});
