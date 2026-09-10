import { describe, expect, it } from 'vitest';
import {
  API_PATHS, CATEGORIES, formatLedgerAmount, ledgerTypeLabel, productsListPath, productsMinePath, ordersListPath, walletLedgerPath,
} from './contracts';

describe('ONIX API paths', () => {
  it('matches backend resource routes', () => {
    expect(API_PATHS.me).toBe('/api/users/me');
    expect(API_PATHS.productPurchase('product/1')).toBe('/api/orders/product/product%2F1');
    expect(API_PATHS.favorite('p1')).toBe('/api/favorites/p1');
    expect(API_PATHS.follow('ONIX-000007')).toBe('/api/users/ONIX-000007/follow');
    expect(API_PATHS.messages('chat/1')).toBe('/api/chats/chat%2F1/messages');
    expect(API_PATHS.addChatMembers('chat/1')).toBe('/api/chats/chat%2F1/members');
    expect(API_PATHS.createGroupChat).toBe('/api/chats/groups');
    expect(API_PATHS.messageDelete('c1', 'm1', 'global')).toBe('/api/chats/c1/messages/m1?scope=global');
    expect(API_PATHS.reviewCreate('42')).toBe('/api/orders/42/reviews');
    expect(API_PATHS.walletWithdraw).toBe('/api/wallet/withdrawals');
    expect(API_PATHS.walletDeposit).toBe('/api/wallet/deposit');
    expect(API_PATHS.walletDepositLocks).toBe('/api/wallet/deposit/locks');
    expect(API_PATHS.meTrust).toBe('/api/users/me/trust');
    expect(API_PATHS.meAnalytics()).toBe('/api/users/me/analytics');
    expect(API_PATHS.meAnalytics(0)).toBe('/api/users/me/analytics');
    expect(API_PATHS.meAnalytics(-1)).toBe('/api/users/me/analytics?weekOffset=-1');
    expect(API_PATHS.userTrustCard('ONIX-000007')).toBe('/api/users/ONIX-000007/trust-card');
    expect(API_PATHS.orderRefundRequest('42')).toBe('/api/orders/42/refund-request');
    expect(API_PATHS.dealCancel('42')).toBe('/api/orders/42/cancel');
    expect(API_PATHS.subcategories).toBe('/api/products/catalog/subcategories');
    expect(API_PATHS.productCategoryCounts).toBe('/api/products/catalog/counts');
  });

  it('builds orders list query', () => {
    expect(ordersListPath({})).toBe('/api/orders');
    expect(ordersListPath({ sort: 'newest', status: 'active' })).toBe('/api/orders?sort=newest&status=active');
    expect(API_PATHS.ordersList({ sort: 'cheap', status: 'dispute' })).toBe('/api/orders?sort=cheap&status=dispute');
  });

  it('builds marketplace list query without empty search', () => {
    expect(productsListPath({})).toBe('/api/products');
    expect(productsListPath({ search: '  ', category: 'STEAM', sort: 'rating', limit: 30, offset: 0 }))
      .toBe('/api/products?category=STEAM&sort=rating&limit=30&offset=0');
    expect(productsListPath({ search: 'Knife', minPriceCents: '1000', maxPriceCents: '50000' }))
      .toBe('/api/products?search=Knife&minPriceCents=1000&maxPriceCents=50000');
    expect(productsListPath({ limit: 15, cursor: 'newest|id|2026-01-01T00:00:00.000Z' }))
      .toBe('/api/products?limit=15&cursor=newest%7Cid%7C2026-01-01T00%3A00%3A00.000Z');
  });

  it('builds lazy wallet ledger and mine listings pages', () => {
    expect(walletLedgerPath({ limit: 15, offset: 15 })).toBe('/api/wallet/ledger?limit=15&offset=15');
    expect(productsMinePath({ limit: 15, offset: 0 })).toBe('/api/products/mine?limit=15&offset=0');
    expect(API_PATHS.walletLedger({ limit: 15, offset: 30 })).toBe('/api/wallet/ledger?limit=15&offset=30');
  });

  it('labels wallet purchases in plain language and signs credits', () => {
    expect(ledgerTypeLabel('PURCHASE_HOLD')).toBe('Покупки');
    expect(formatLedgerAmount('100000')).toMatch(/^\+1[\s\u00a0]000,00[\s\u00a0]₽$/);
    expect(formatLedgerAmount('-100000')).toMatch(/^−1[\s\u00a0]000,00[\s\u00a0]₽$/);
    expect(formatLedgerAmount('50000')).toMatch(/^\+/);
  });

  it('uses canonical backend category enum values', () => {
    expect(CATEGORIES).toEqual([
      'STEAM', 'ROBLOX', 'RP_PROJECTS',
      'CS2', 'STANDOFF_2', 'FORTNITE', 'BRAWL_STARS', 'GTA_5', 'GTA_6',
      'DOTA_2', 'PUBG_MOBILE', 'GENSHIN', 'MOBILE_LEGENDS', 'APP_STORE',
      'PUBG', 'MINECRAFT', 'PLAYSTATION', 'STALCRAFT', 'PATH_OF_EXILE_2', 'OTHER',
    ]);
  });
});
