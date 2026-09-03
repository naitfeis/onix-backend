/// <reference types="node" />

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const appCss = readFileSync(new URL('../App.css', import.meta.url), 'utf8');

describe('desktop and chat layout CSS regressions', () => {
  it('keeps the virtual message scroller block-based and aligns nested outgoing rows', () => {
    expect(appCss).toMatch(
      /\.app-shell--chat \.messages\.messages--virtual\s*\{[^}]*display:\s*block;/s,
    );
    expect(appCss).toMatch(
      /\.messages__virtual-row > \.message-row\.mine\s*\{[^}]*margin-left:\s*auto;/s,
    );
  });

  it('reserves the desktop right rail for the market shell', () => {
    expect(appCss).toMatch(
      /@media \(min-width: 1280px\)\s*\{[\s\S]*?\.app-shell\.app-shell--market\s*\{[^}]*var\(--sidebar-right-w/s,
    );
    expect(appCss).not.toMatch(
      /\.app-shell\s*\{[^}]*grid-template-columns:[^}]*var\(--sidebar-right-w/s,
    );
  });

  it('stretches market categories across the canvas with spacing', () => {
    expect(appCss).toMatch(
      /\.cat-row\s*\{[^}]*display:\s*grid;/s,
    );
    expect(appCss).toMatch(
      /\.cat-row\s*\{[^}]*gap:\s*12px 10px;/s,
    );
    expect(appCss).toMatch(
      /\.market-hero \.button--violet\s*\{[^}]*box-shadow:\s*none;/s,
    );
  });

  it('does not force a crushed icon rail between 900px and 1099px', () => {
    expect(appCss).not.toMatch(/@media \(min-width: 900px\) and \(max-width: 1099px\)/);
  });

  it('keeps AI helper questions as a glass overlay above messages', () => {
    expect(appCss).toMatch(
      /\.ai-actions\s*\{[^}]*position:\s*absolute;/s,
    );
    expect(appCss).toMatch(
      /\.ai-actions\s*\{[^}]*backdrop-filter:\s*blur\(18px\) saturate\(160%\);/s,
    );
  });

  it('keeps new-lot rows from collapsing and clips long titles', () => {
    expect(appCss).toMatch(
      /\.widget-trend__title\s*\{[^}]*text-overflow:\s*ellipsis;/s,
    );
    expect(appCss).toMatch(
      /\.widget-trend__copy\s*\{[^}]*min-width:\s*0;/s,
    );
    expect(appCss).toMatch(
      /\.widget-trend__row strong\s*\{[^}]*white-space:\s*nowrap;/s,
    );
    expect(appCss).toMatch(
      /\.widget-trend__row\s*\{[^}]*flex:\s*0 0 auto;/s,
    );
    expect(appCss).toMatch(
      /\.widget-trend__row\s*\{[^}]*min-height:\s*36px;/s,
    );
  });

  it('stretches the new-lots widget to the bottom of the right rail', () => {
    expect(appCss).toMatch(
      /\.sidebar-right > \.widget--new-lots\s*\{[^}]*flex:\s*1 1 auto;/s,
    );
    expect(appCss).toMatch(
      /\.sidebar-right > \.widget--new-lots\s*\{[^}]*min-height:\s*180px;/s,
    );
    expect(appCss).toMatch(
      /\.app-shell--market > \.sidebar-right\s*\{[^}]*overflow:\s*hidden;/s,
    );
    expect(appCss).toMatch(
      /\.sidebar-right > \.widget--new-lots \.widget-trend\s*\{[^}]*overflow-y:\s*auto;/s,
    );
  });

  it('keeps checkout and deal lot badges outlined without fill', () => {
    expect(appCss).toMatch(
      /\.lot-sheet__badge\s*\{[^}]*background:\s*transparent;/s,
    );
    expect(appCss).not.toMatch(
      /\.lot-sheet__badges \.lot-sheet__badge\s*\{[^}]*background:\s*#6B5FE0;/s,
    );
    expect(appCss).not.toMatch(
      /\.lot-sheet__badge--auto\s*\{[^}]*color:\s*#f5c14a;/s,
    );
  });

  it('uses the deeper semantic accent behind unread counts', () => {
    expect(appCss).toMatch(
      /\.thread em, \.nav-count\s*\{[^}]*background:\s*var\(--accent-coral-deep\);/s,
    );
    expect(appCss).toMatch(
      /\.sidebar-nav__badge\s*\{[^}]*background:\s*var\(--accent-coral-deep\);/s,
    );
  });

  it('renders category lot share as a corner badge with a black core', () => {
    expect(appCss).toMatch(/\.cat-card__ring[\s\S]*?position:\s*absolute;/);
    expect(appCss).toMatch(/\.cat-card__ring[\s\S]*?top:\s*-5px;/);
    expect(appCss).toMatch(/\.cat-card__ring[\s\S]*?right:\s*-5px;/);
    expect(appCss).toMatch(/\.cat-card__ring::before[\s\S]*?background:\s*#0b0b0c;/);
    expect(appCss).toMatch(/\.cat-card__ring-value[\s\S]*?stroke:\s*#fff;/);
    expect(appCss).toMatch(/\.cat-card__ring-num[\s\S]*?font-variant-numeric:\s*tabular-nums;/);
    expect(appCss).toMatch(/html\[data-theme="light"\] \.cat-card__emblem--other[\s\S]*?background:\s*#fff/);
    expect(appCss).toMatch(/html\[data-theme="light"\] \.cat-card__dots i[\s\S]*?background:\s*#111;/);
  });

  it('keeps market notifications clipped instead of scrollable', () => {
    expect(appCss).toMatch(/\.widget-notify\s*\{[^}]*overflow:\s*hidden;/s);
    expect(appCss).toMatch(/\.sidebar-right > \.widget--notify\s*\{[^}]*overflow:\s*hidden;/s);
  });

  it('slides settings in from the right on desktop and from the top on phones', () => {
    expect(appCss).toMatch(/\.settings-overlay\s*\{[^}]*z-index:\s*1200;/s);
    expect(appCss).toMatch(/\.settings-sheet\s*\{[^}]*transform:\s*translateX\(100%\);/s);
    expect(appCss).toMatch(/@media \(max-width: 699px\)\s*\{[\s\S]*?\.settings-sheet\s*\{[^}]*transform:\s*translateY\(-110%\);/s);
    expect(appCss).toMatch(/\.settings-sheet__backdrop\s*\{[^}]*background:\s*transparent/s);
    expect(appCss).toMatch(/\.settings-overlay\s*\{[^}]*backdrop-filter:\s*none/s);
    expect(appCss).toMatch(/\.settings-sheet\s*\{[^}]*background:\s*#151517;/s);
  });

  it('does not collapse shell padding or hide the dock when opening chat', () => {
    expect(appCss).not.toMatch(/\.app-shell--chat\s*\{[^}]*padding-inline:\s*0;/s);
    expect(appCss).not.toMatch(/\.app-shell--chat \.sidebar-right \{ display: none; \}/);
    expect(appCss).toMatch(/\.bottom-nav\s*\{[^}]*margin-inline:\s*auto;/s);
    expect(appCss).toMatch(/\.bottom-nav button\s*\{[^}]*font-weight:\s*600;/s);
  });

  it('paints inactive hero pager dots grey and the active pill in theme ink', () => {
    expect(appCss).toMatch(/\.market-hero \.desktop-hero__dots button\s*\{[^}]*background:\s*rgba\(255, 255, 255, 0\.32\);/s);
    expect(appCss).toMatch(/html\[data-theme="light"\] \.market-hero \.desktop-hero__dots button\s*\{[^}]*background:\s*rgba\(17, 17, 17, 0\.28\);/s);
    expect(appCss).toMatch(/\.market-hero \.desktop-hero__dots button\.active\s*\{[^}]*background:\s*#fff;/s);
    expect(appCss).toMatch(/html\[data-theme="light"\] \.market-hero \.desktop-hero__dots button\.active\s*\{[^}]*background:\s*#111;/s);
  });

  it('keeps new-lot titles and prices high-contrast in both themes', () => {
    expect(appCss).toMatch(/\.widget-trend__title\s*\{[^}]*color:\s*#fff;/s);
    expect(appCss).toMatch(/html\[data-theme="light"\] \.widget-trend__title\s*\{[^}]*color:\s*#111;/s);
    expect(appCss).toMatch(/\.widget-trend__row strong\s*\{[^}]*color:\s*#fff;/s);
    expect(appCss).toMatch(/html\[data-theme="light"\] \.widget-trend__row strong\s*\{[^}]*color:\s*#111;/s);
  });
});
