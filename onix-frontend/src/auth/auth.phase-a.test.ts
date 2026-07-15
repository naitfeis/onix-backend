import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@twa-dev/sdk', () => ({
  default: { initData: '' },
}));

import {
  buildApiUrl,
  isSameOriginApi,
  resolveApiBase,
  shouldIncludeCredentials,
} from './apiConfig';
import {
  createWebsiteAuthProvider,
  resetWebsiteAuthProvider,
} from './createWebsiteAuthProvider';
import { isWebsiteAuthV2, resolveWebsiteAuthMode } from './mode';

beforeEach(() => {
  resetWebsiteAuthProvider();
});

describe('resolveWebsiteAuthMode', () => {
  it('defaults to legacy', () => {
    expect(resolveWebsiteAuthMode(undefined)).toBe('legacy');
    expect(resolveWebsiteAuthMode('')).toBe('legacy');
    expect(resolveWebsiteAuthMode('nope')).toBe('legacy');
  });

  it('accepts temporary auth_v2 cutover values', () => {
    expect(resolveWebsiteAuthMode('auth_v2')).toBe('auth_v2');
    expect(resolveWebsiteAuthMode('V2')).toBe('auth_v2');
    expect(resolveWebsiteAuthMode('new')).toBe('auth_v2');
    expect(isWebsiteAuthV2('auth_v2')).toBe(true);
    expect(isWebsiteAuthV2('legacy')).toBe(false);
  });
});

describe('apiConfig same-origin', () => {
  it('treats empty VITE_API_URL as same-origin relative API', () => {
    expect(resolveApiBase('')).toBe('');
    expect(resolveApiBase('  ')).toBe('');
    expect(isSameOriginApi('')).toBe(true);
    expect(shouldIncludeCredentials('')).toBe(true);
    expect(buildApiUrl('/api/v2/auth/me', '')).toBe('/api/v2/auth/me');
  });

  it('keeps absolute bases without credential forcing', () => {
    const base = 'https://onix-api-47tj.onrender.com';
    expect(resolveApiBase(`${base}/`)).toBe(base);
    expect(isSameOriginApi(base)).toBe(false);
    expect(shouldIncludeCredentials(base)).toBe(false);
    expect(buildApiUrl('/api/auth/telegram-mini', base)).toBe(`${base}/api/auth/telegram-mini`);
  });
});

describe('createWebsiteAuthProvider', () => {
  it('returns legacy provider by default', () => {
    const provider = createWebsiteAuthProvider('legacy');
    expect(provider.mode).toBe('legacy');
  });

  it('returns auth_v2 provider backed by AuthManager', async () => {
    const provider = createWebsiteAuthProvider('auth_v2');
    expect(provider.mode).toBe('auth_v2');
    expect(provider.getAccessToken()).toBeNull();
    await expect(provider.loginWithTelegram({})).rejects.toThrow(/id must be a numeric string/);
  });
});
