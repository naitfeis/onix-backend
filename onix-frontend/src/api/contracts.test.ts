import { describe, expect, it } from 'vitest';
import { API_PATHS, CATEGORIES, productsListPath, ordersListPath } from './contracts';

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
    expect(API_PATHS.adminBan('ONIX-000007')).toBe('/api/admin/users/ONIX-000007/ban');
    expect(API_PATHS.adminStatus('ONIX-7')).toBe('/api/admin/users/ONIX-7/status');
    expect(API_PATHS.orderRefundRequest('42')).toBe('/api/orders/42/refund-request');
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
  });

  it('uses canonical backend category enum values', () => {
    expect(CATEGORIES).toEqual([
      'STANDOFF_2', 'STEAM', 'ROBLOX', 'RP_PROJECTS', 'BRAWL_STARS', 'OTHER',
    ]);
  });
});
