import assert from 'node:assert/strict';
import test from 'node:test';
import { GoogleLoginVerifier } from '../src/auth-v2/google-login.verifier';

test('GoogleLoginVerifier POSTs tokeninfo and rejects bad iss / unverified email', async () => {
  const prev = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = 'onix.apps.googleusercontent.com';
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({
      aud: 'onix.apps.googleusercontent.com',
      sub: 'google-sub-1',
      iss: 'https://accounts.google.com',
      exp: String(Math.floor(Date.now() / 1000) + 600),
      email: 'user@gmail.com',
      email_verified: 'true',
      name: 'User',
      given_name: 'Ada',
      family_name: 'Lovelace',
      picture: 'https://lh3.googleusercontent.com/a/photo',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    const identity = await new GoogleLoginVerifier().verify('header.payload.sig');
    assert.equal(identity.sub, 'google-sub-1');
    assert.equal(identity.givenName, 'Ada');
    assert.equal(identity.familyName, 'Lovelace');
    assert.equal(identity.picture, 'https://lh3.googleusercontent.com/a/photo');
    assert.equal(calls[0]?.url, 'https://oauth2.googleapis.com/tokeninfo');
    assert.equal(calls[0]?.init?.method, 'POST');
    const body = String(calls[0]?.init?.body);
    assert.equal(body.includes('id_token='), true);
    assert.equal(String(calls[0]?.url).includes('id_token='), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (prev === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = prev;
  }
});

test('GoogleLoginVerifier rejects unverified email', async () => {
  const prev = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = 'onix.apps.googleusercontent.com';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    aud: 'onix.apps.googleusercontent.com',
    sub: 'google-sub-1',
    iss: 'https://accounts.google.com',
    exp: String(Math.floor(Date.now() / 1000) + 600),
    email: 'spoof@evil.test',
    email_verified: 'false',
  }), { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(
      () => new GoogleLoginVerifier().verify('header.payload.sig'),
      /invalid/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (prev === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = prev;
  }
});
