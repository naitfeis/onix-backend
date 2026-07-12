import { describe, expect, it } from 'vitest';
import { API_PATHS, CATEGORIES } from './contracts';

describe('ONIX API paths', () => {
  it('matches backend resource routes', () => {
    expect(API_PATHS.me).toBe('/api/users/me');
    expect(API_PATHS.productPurchase('product/1')).toBe('/api/orders/product/product%2F1');
    expect(API_PATHS.favorite('p1')).toBe('/api/favorites/p1');
    expect(API_PATHS.follow('ONIX-000007')).toBe('/api/users/ONIX-000007/follow');
    expect(API_PATHS.messages('chat/1')).toBe('/api/chats/chat%2F1/messages');
    expect(API_PATHS.reviewCreate('42')).toBe('/api/orders/42/reviews');
    expect(API_PATHS.walletWithdraw).toBe('/api/wallet/withdrawals');
    expect(API_PATHS.adminBan('ONIX-000007')).toBe('/api/admin/users/ONIX-000007/ban');
  });

  it('uses canonical backend category enum values', () => {
    expect(CATEGORIES).toEqual([
      'STANDOFF_2', 'STEAM', 'ROBLOX', 'RP_PROJECTS', 'BRAWL_STARS', 'OTHER',
    ]);
  });
});
