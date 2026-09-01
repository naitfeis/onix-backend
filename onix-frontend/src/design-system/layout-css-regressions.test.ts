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

  it('keeps AI helper questions as a hideable overlay above the transcript', () => {
    expect(appCss).toMatch(
      /\.ai-actions\s*\{[^}]*position:\s*absolute;/s,
    );
    expect(appCss).toMatch(
      /\.ai-actions\s*\{[^}]*z-index:\s*8;/s,
    );
  });

  it('keeps new-lot titles ellipsized and prices fully visible in the right rail', () => {
    expect(appCss).toMatch(
      /\.widget-trend__title\s*\{[^}]*text-overflow:\s*ellipsis;/s,
    );
    expect(appCss).toMatch(
      /\.widget-trend__copy\s*\{[^}]*min-width:\s*0;/s,
    );
    expect(appCss).toMatch(
      /\.widget-trend__row strong\s*\{[^}]*white-space:\s*nowrap;/s,
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
});
