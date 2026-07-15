/** In-memory access token store. Never touches Web Storage or document.cookie. */

let accessToken: string | null = null;

export function readMemoryAccessToken(): string | null {
  return accessToken;
}

export function writeMemoryAccessToken(token: string): void {
  accessToken = token;
}

export function clearMemoryAccessToken(): void {
  accessToken = null;
}

/** Test helper — resets module state between cases. */
export function resetMemoryAccessTokenStore(): void {
  accessToken = null;
}
