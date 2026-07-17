/** Small cuid-like id without extra dependency (matches Prisma @default(cuid) style). */
export function createId(): string {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  return `c${time}${rand}`.slice(0, 25);
}
