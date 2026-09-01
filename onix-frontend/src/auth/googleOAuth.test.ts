import { describe, expect, it } from 'vitest';
import {
  buildGoogleOAuthUrl,
  googleRedirectUri,
  interpretGoogleOAuthReturn,
} from './googleOAuth';

function jwtWithNonce(nonce: string): string {
  const payload = btoa(JSON.stringify({ nonce }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `header.${payload}.sig`;
}

describe('google OAuth redirect', () => {
  it('uses origin slash as redirect_uri', () => {
    expect(googleRedirectUri('https://www.onixtg.shop')).toBe('https://www.onixtg.shop/');
    expect(googleRedirectUri('https://www.onixtg.shop/')).toBe('https://www.onixtg.shop/');
    const url = buildGoogleOAuthUrl(
      'abc.apps.googleusercontent.com',
      'https://www.onixtg.shop',
      'st',
      'nn',
    );
    expect(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')).toBe(true);
    expect(url.includes('response_type=id_token')).toBe(true);
    expect(url.includes(encodeURIComponent('https://www.onixtg.shop/'))).toBe(true);
    expect(url.includes('gsi/transform')).toBe(false);
  });

  it('ignores ordinary marketplace URLs', () => {
    expect(interpretGoogleOAuthReturn('https://www.onixtg.shop/', 'st', 'nn')).toBeNull();
  });

  it('accepts hash id_token when state and nonce match', () => {
    const token = jwtWithNonce('nn');
    const href = `https://www.onixtg.shop/#id_token=${token}&state=st`;
    expect(interpretGoogleOAuthReturn(href, 'st', 'nn')).toEqual({ ok: true, idToken: token });
  });

  it('rejects state mismatch and Google error', () => {
    const token = jwtWithNonce('nn');
    expect(interpretGoogleOAuthReturn(
      `https://www.onixtg.shop/#id_token=${token}&state=other`,
      'st',
      'nn',
    )).toEqual({ ok: false, error: 'state_mismatch' });
    expect(interpretGoogleOAuthReturn(
      'https://www.onixtg.shop/?error=access_denied',
      'st',
      'nn',
    )).toEqual({ ok: false, error: 'access_denied' });
  });
});
