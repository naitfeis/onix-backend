import { describe, expect, it } from 'vitest';
import {
  API_PATHS,
  API_PATH_STATUS,
  CATEGORIES,
  SUBCATEGORIES_BY_CATEGORY,
  isStaffPlatformStatus,
} from './contracts';

/**
 * FE / API / money-path contract matrix (audit gate).
 * Capability → FE action path status must stay intentional.
 */
describe('ONIX contract matrix', () => {
  it('cancel order is LIVE and points at BE cancel', () => {
    expect(API_PATH_STATUS.dealCancel).toBe('LIVE');
    expect(API_PATHS.dealCancel('42')).toBe('/api/orders/42/cancel');
  });

  it('order money-path actions are LIVE', () => {
    expect(API_PATH_STATUS.dealDeliver).toBe('LIVE');
    expect(API_PATH_STATUS.dealComplete).toBe('LIVE');
    expect(API_PATH_STATUS.dealDispute).toBe('LIVE');
    expect(API_PATHS.dealDeliver('1')).toBe('/api/orders/1/deliver');
    expect(API_PATHS.dealComplete('1')).toBe('/api/orders/1/complete');
    expect(API_PATHS.dealDispute('1')).toBe('/api/orders/1/dispute');
  });

  it('subcategories catalog is LIVE (BE source of truth)', () => {
    expect(API_PATH_STATUS.subcategories).toBe('LIVE');
    expect(API_PATHS.subcategories).toBe('/api/products/catalog/subcategories');
    for (const category of CATEGORIES) {
      expect(SUBCATEGORIES_BY_CATEGORY[category].length).toBeGreaterThan(0);
    }
  });

  it('classifies intentionally unused FE paths', () => {
    expect(API_PATH_STATUS.meVerifications).toBe('FUTURE');
    expect(API_PATH_STATUS.mePro).toBe('FUTURE');
    expect(API_PATH_STATUS.supportClose).toBe('DEPRECATED');
  });

  it('staff visibility uses canonical platformStatus', () => {
    expect(isStaffPlatformStatus('USER')).toBe(false);
    expect(isStaffPlatformStatus('VIP')).toBe(false);
    expect(isStaffPlatformStatus('VERIFIED_SELLER')).toBe(false);
    expect(isStaffPlatformStatus('MODERATOR')).toBe(true);
    expect(isStaffPlatformStatus('ADMIN')).toBe(true);
    expect(isStaffPlatformStatus('SUPER_ADMIN')).toBe(true);
  });
});
