import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = ComponentType<any>;

/**
 * lazy() with retries — RU paths to Vercel often hit net::ERR_CONNECTION_RESET
 * on the first dynamic chunk fetch; a short retry usually succeeds.
 */
export function lazyRetry(
  factory: () => Promise<{ default: AnyComponent }>,
  retries = 3,
): LazyExoticComponent<AnyComponent> {
  return lazy(async () => {
    let last: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await factory();
      } catch (error) {
        last = error;
        if (attempt >= retries) break;
        await new Promise((resolve) => setTimeout(resolve, 280 * (attempt + 1)));
      }
    }
    throw last;
  });
}
