import { describe, expect, it } from 'vitest';
import { detectBrowserLocale, isMarketAllCategory, MARKET_ALL_CATEGORY } from './index';

describe('i18n locale detection', () => {
  it('maps Russian tags to ru and every other European tag to en', () => {
    const original = {
      language: navigator.language,
      languages: navigator.languages,
    };
    const stub = (language: string, languages: string[]) => {
      Object.defineProperty(navigator, 'language', { configurable: true, value: language });
      Object.defineProperty(navigator, 'languages', { configurable: true, value: languages });
    };
    try {
      stub('ru-RU', ['ru-RU']);
      expect(detectBrowserLocale()).toBe('ru');
      stub('en-US', ['en-US']);
      expect(detectBrowserLocale()).toBe('en');
      stub('de-DE', ['de-DE']);
      expect(detectBrowserLocale()).toBe('en');
      stub('cs-CZ', ['cs-CZ']);
      expect(detectBrowserLocale()).toBe('en');
      stub('pl-PL', ['pl-PL']);
      expect(detectBrowserLocale()).toBe('en');
    } finally {
      Object.defineProperty(navigator, 'language', { configurable: true, value: original.language });
      Object.defineProperty(navigator, 'languages', { configurable: true, value: original.languages });
    }
  });

  it('treats ALL / Все / All as the same market filter', () => {
    expect(isMarketAllCategory(MARKET_ALL_CATEGORY)).toBe(true);
    expect(isMarketAllCategory('Все')).toBe(true);
    expect(isMarketAllCategory('All')).toBe(true);
    expect(isMarketAllCategory('STEAM')).toBe(false);
  });
});
