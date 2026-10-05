import { describe, expect, it } from 'vitest';
import CategoryCountBadge, { categoryCountBadgeState } from './CategoryCountBadge';

describe('categoryCountBadgeState', () => {
  it('has no filled arc for zero', () => {
    expect(categoryCountBadgeState(0, 10).degrees).toBe(0);
  });

  it('fills the arc proportionally for non-zero counts', () => {
    expect(Math.round(categoryCountBadgeState(5, 10).degrees)).toBe(180);
  });

  it('uses a full circle at 100% and caps the label at 99+', () => {
    const full = categoryCountBadgeState(100, 100);
    expect(full.degrees).toBe(360);
    expect(full.isFull).toBe(true);
    expect(full.shown).toBe('99+');
  });
});

describe('CategoryCountBadge class contract', () => {
  it('renders the zero badge without a filled modifier', () => {
    const badge = CategoryCountBadge({ count: 0, total: 10 }) as JSX.Element;
    expect(badge.props.className).not.toContain('cat-card__share--full');
    expect(badge.props.style['--share-deg']).toBe('0deg');
  });

  it('renders a non-zero badge with the proportional arc and text', () => {
    const badge = CategoryCountBadge({ count: 2, total: 10 }) as JSX.Element;
    expect(badge.props.className).not.toContain('cat-card__share--full');
    expect(badge.props.style['--share-deg']).toBe('72deg');
    expect(badge.props.children.props.children).toBe('2');
  });

  it('renders the sidebar variant compact class', () => {
    const badge = CategoryCountBadge({ count: 2, total: 10, variant: 'sidebar' }) as JSX.Element;
    expect(badge.props.className).toContain('cat-card__share--sidebar');
    expect(badge.props.className).not.toContain('cat-card__share--sidebar--full');
  });

  it('uses the sidebar-specific full modifier at 100%', () => {
    const badge = CategoryCountBadge({ count: 10, total: 10, variant: 'sidebar' }) as JSX.Element;
    expect(badge.props.className).toContain('cat-card__share--sidebar--full');
    expect(badge.props.className).not.toContain('cat-card__share--full ');
  });
});
