/// <reference types="node" />

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const appCss = readFileSync(new URL('../App.css', import.meta.url), 'utf8');
const tokensCss = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');

describe('desktop and chat layout CSS regressions', () => {
  it('keeps the virtual message scroller block-based and aligns nested outgoing rows', () => {
    expect(appCss).toMatch(
      /\.app-shell--chat \.messages\.messages--virtual\s*\{[^}]*display:\s*block;/s,
    );
    expect(appCss).toMatch(
      /\.messages__virtual-row > \.message-row\.mine\s*\{[^}]*margin-left:\s*auto;/s,
    );
  });

  it('pins the desktop left rail to the screen edge and removes the right rail', () => {
    expect(appCss).toMatch(
      /\.app-shell\s*\{[^}]*grid-template-columns:\s*var\(--sidebar-left-w,[^;]*;[\s\S]*?padding:\s*0;/s,
    );
    expect(appCss).not.toMatch(
      /--sidebar-right-w/,
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

  it('keeps chat threads spaced so they do not stick together', () => {
    expect(appCss).toMatch(/\.thread-list\s*\{[^}]*gap:\s*8px;/s);
    expect(appCss).toMatch(/@media \(max-width: 699px\)\s*\{[\s\S]*?\.thread-list\s*\{[^}]*gap:\s*10px;/s);
    expect(appCss).not.toMatch(/\.thread-list, \.conversation\s*\{[^}]*gap:\s*0;/s);
  });

  it('keeps thread rows horizontal and tight under the topbar on chat', () => {
    expect(appCss).toMatch(/\.thread-peer\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;/s);
    expect(appCss).not.toMatch(/\.thread span\s*\{[^}]*display:\s*grid;/s);
    expect(appCss).toMatch(/\.app-shell--chat \.topbar\s*\{[^}]*margin-bottom:\s*4px;/s);
    expect(appCss).toMatch(/\.app-shell--chat \.viewport\s*\{[^}]*padding-top:\s*0;/s);
  });

  it('keeps screens keep-alive without page-turn remount animation', () => {
    expect(appCss).toMatch(/\.screen-panel\.is-active\s*\{[^}]*display:\s*block;/s);
    expect(appCss).toMatch(/\.screen-transition\s*\{[^}]*animation:\s*none;/s);
  });

  it('does not force a crushed icon rail between 900px and 1099px', () => {
    // The original regression was a 900–1099 block that overrode the shell grid
    // to `84px minmax(0, 1fr)`, squeezing the icon rail. That range is also used
    // legitimately for the category grid, so assert the actual crush instead of
    // banning the media query outright.
    const range = /@media \(min-width: 900px\) and \(max-width: 1099px\)\s*\{([\s\S]*?)\n\}/g;
    const blocks = [...appCss.matchAll(range)].map((m) => m[1] ?? '');
    for (const block of blocks) {
      expect(block).not.toMatch(/\.app-shell\s*\{[^}]*grid-template-columns:\s*84px/s);
      expect(block).not.toMatch(/grid-template-columns:\s*84px/);
      expect(block).not.toMatch(/\.icon-rail\s*\{/);
      expect(block).not.toMatch(/--rail-w|\.left-rail\s*\{/);
    }
  });

  it('keeps AI helper questions as a solid overlay above messages', () => {
    expect(appCss).toMatch(
      /\.ai-actions\s*\{[^}]*position:\s*absolute;/s,
    );
    expect(appCss).toMatch(
      /\.ai-actions\s*\{[^}]*backdrop-filter:\s*none;/s,
    );
  });

  it('keeps the market hero above the category grid without overlaps', () => {
    expect(appCss).toMatch(
      /@media \(min-width: 1100px\)\s*\{[\s\S]*?\.market-hero\s*\{[\s\S]*?z-index:\s*1;/s,
    );
    expect(appCss).toMatch(
      /@media \(min-width: 1100px\)\s*\{[\s\S]*?\.market-hero\s*\{[\s\S]*?margin-bottom:\s*20px;/s,
    );
    expect(appCss).toMatch(
      /\.cat-block--recent\s*\{[^}]*margin:\s*0 0 16px;/s,
    );
    expect(appCss).toMatch(
      /\.cat-row--recent\s*\{[^}]*overflow-x:\s*auto;[\s\S]*?scrollbar-width:\s*thin;/s,
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

  it('renders category lot share as a white outline circle badge', () => {
    expect(appCss).toMatch(/\.cat-card__share[\s\S]*?position:\s*absolute;/);
    expect(appCss).toMatch(/\.cat-card__share[\s\S]*?top:\s*-5px;/);
    expect(appCss).toMatch(/\.cat-card__share[\s\S]*?right:\s*-5px;/);
    expect(appCss).toMatch(/\.cat-card__share::before[\s\S]*?conic-gradient\(#fff/);
    expect(appCss).toMatch(/\.cat-card__share-num[\s\S]*?background:\s*transparent;/);
    expect(appCss).toMatch(/\.cat-card__share-num[\s\S]*?font-variant-numeric:\s*tabular-nums;/);
    expect(appCss).toMatch(/html\[data-theme="light"\] \.cat-card__emblem--other[\s\S]*?background:\s*#fff/);
    expect(appCss).toMatch(/html\[data-theme="light"\] \.cat-card__dots i[\s\S]*?background:\s*#111;/);
  });

  it('keeps the recent categories row scrollable without gaps', () => {
    expect(appCss).toMatch(/\.cat-row--recent\s*\{[^}]*overflow-x:\s*auto;/s);
    expect(appCss).toMatch(/\.cat-row--recent\s*\{[^}]*scrollbar-width:\s*thin;/s);
  });

  it('slides settings in from the right on desktop and from the top on phones', () => {
    expect(appCss).toMatch(/\.settings-overlay\s*\{[^}]*z-index:\s*1200;/s);
    expect(appCss).toMatch(/\.settings-sheet\s*\{[^}]*transform:\s*translateX\(100%\);/s);
    expect(appCss).toMatch(/@media \(max-width: 699px\)\s*\{[\s\S]*?\.settings-sheet\s*\{[^}]*transform:\s*translateY\(-110%\);/s);
    expect(appCss).toMatch(/\.settings-sheet__backdrop\s*\{[^}]*background:\s*transparent/s);
    expect(appCss).toMatch(/\.settings-overlay\s*\{[^}]*backdrop-filter:\s*none/s);
    expect(appCss).toMatch(/\.settings-sheet\s*\{[^}]*backdrop-filter:\s*none !important;/s);
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

  it('applies Vision glass blur to the market banner and chrome', () => {
    expect(tokensCss).toMatch(/html\[data-glass="vision"\] \.market-hero/);
    expect(tokensCss).toMatch(
      /html\[data-glass="vision"\] \.card,[\s\S]*?\.market-hero,[\s\S]*?backdrop-filter:\s*blur\(var\(--glass-blur\)\) saturate\(var\(--glass-saturate\)\) !important;/s,
    );
  });

  it('keeps the Google bind row on its own full-width profile grid line', () => {
    expect(appCss).toMatch(/\.profile-card > \.profile-accounts[\s\S]*?grid-column:\s*1 \/ -1;/s);
    expect(appCss).toMatch(/\.card\.profile-card\s*\{[^}]*overflow:\s*visible;/s);
    expect(appCss).toMatch(/\.profile-account \.auth-btn\s*\{[^}]*flex-shrink:\s*0;/s);
    expect(appCss).toMatch(/\.profile-card\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto;/s);
  });
});
