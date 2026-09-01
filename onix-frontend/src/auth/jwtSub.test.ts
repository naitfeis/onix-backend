import { describe, expect, it } from 'vitest';
import { readJwtSub } from './jwtSub';

describe('readJwtSub', () => {
  it('reads sub from a JWT payload', () => {
    const payload = btoa(JSON.stringify({ sub: '42' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    expect(readJwtSub(`hdr.${payload}.sig`)).toBe('42');
  });

  it('returns null for garbage', () => {
    expect(readJwtSub(null)).toBeNull();
    expect(readJwtSub('not-a-jwt')).toBeNull();
  });
});
