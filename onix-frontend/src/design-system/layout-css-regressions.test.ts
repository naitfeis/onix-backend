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

  it('keeps market categories packed edge to edge without column air', () => {
    expect(appCss).toMatch(
      /\.cat-row\s*\{[^}]*display:\s*flex;/s,
    );
    expect(appCss).toMatch(
      /\.cat-row\s*\{[^}]*gap:\s*0;/s,
    );
    expect(appCss).toMatch(
      /\.market-hero \.button--violet\s*\{[^}]*box-shadow:\s*none;/s,
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
