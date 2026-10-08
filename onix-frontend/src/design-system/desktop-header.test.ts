import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const appTsx = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const marketTsx = readFileSync(new URL('../screens/Market.tsx', import.meta.url), 'utf8');
const searchCss = readFileSync(new URL('../components/search/search.css', import.meta.url), 'utf8');

describe('desktop market header', () => {
  it('renders one desktop search and one balance pill', () => {
    const shellSearches = appTsx.match(/<GlobalSearch/g) ?? [];
    const marketSearches = marketTsx.match(/<GlobalSearch/g) ?? [];
    expect(shellSearches.length).toBe(1);
    expect(marketSearches.length).toBe(0);

    const shellPills = appTsx.match(/<BalancePill/g) ?? [];
    const marketPills = marketTsx.match(/market-topbar__profile/g) ?? [];
    expect(shellPills.length).toBe(1);
    expect(marketPills.length).toBe(0);
  });

  it('keeps the header one non-wrapping flex row with shared control height', () => {
    expect(searchCss).toMatch(/\.content-head \{[^}]*--topbar-control-height: 44px;/s);
    expect(searchCss).toMatch(/\.content-head \{[^}]*display: flex;[^}]*flex-wrap: nowrap;[^}]*justify-content: space-between;/s);
    expect(searchCss).toMatch(/\.content-head__search \{[^}]*flex: 0 1 640px;[^}]*min-width: 0;/s);
    expect(searchCss).toMatch(/\.content-head__balance \{[^}]*flex: none;/s);
  });
});
