export const SELLER_OFFLINE_SHADOW_MS = 3 * 24 * 60 * 60 * 1000;

export function sellerIsOfflineTooLong(lastSeenAt: Date, now = new Date()): boolean {
  return now.getTime() - lastSeenAt.getTime() >= SELLER_OFFLINE_SHADOW_MS;
}
