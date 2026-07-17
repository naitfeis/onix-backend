import { formatOnixId } from './onix-id';

/**
 * Public display label for API `username` field.
 * Never expose Telegram @username — only displayName (fallback: ONIX id).
 */
export function publicDisplayName(
  displayName: string | null | undefined,
  onixId: string,
): string {
  const name = displayName?.replace(/^@+/, '').trim() ?? '';
  if (
    name
    && !/^\d+$/.test(name)
    && !/^ONIX-/i.test(name)
    && !/^PENDING-/i.test(name)
  ) {
    return name.slice(0, 120);
  }
  return formatOnixId(onixId);
}
