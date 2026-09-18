/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const lotSheet = readFileSync(new URL('./LotSheet.tsx', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../../public/rules.html', import.meta.url), 'utf8');

describe('checkout legal links', () => {
  it('links the platform rules and refund policy from the buy disclosure', () => {
    expect(lotSheet).toContain('<a href="/rules.html">правилами площадки</a>');
    expect(lotSheet).toContain(
      '<a href="/rules.html#refund-policy">политикой возвратов</a>',
    );
  });

  it('keeps the refund link target on substantive refund guidance', () => {
    expect(rules).toMatch(/<h2 id="refund-policy">[^<]*возвраты и споры<\/h2>/i);
    expect(rules).toContain('Покупатель может обратиться в поддержку и открыть спор');
    expect(rules).toContain('Возврат проводится через площадку');
  });
});
