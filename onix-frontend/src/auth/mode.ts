import type { WebsiteAuthMode } from './types';

/**
 * Temporary cutover switch only. Default remains legacy.
 * After Auth V2 production soak, delete this env read and keep auth_v2 only.
 *
 * Accepted values: "legacy" | "auth_v2" (case-insensitive).
 * Anything else → legacy (safe default).
 */
export function resolveWebsiteAuthMode(
  raw: string | undefined = import.meta.env.VITE_WEBSITE_AUTH_MODE as string | undefined,
): WebsiteAuthMode {
  const value = raw?.trim().toLowerCase();
  if (value === 'auth_v2' || value === 'v2' || value === 'new') return 'auth_v2';
  return 'legacy';
}

export function isWebsiteAuthV2(
  raw?: string | undefined,
): boolean {
  return resolveWebsiteAuthMode(raw) === 'auth_v2';
}
