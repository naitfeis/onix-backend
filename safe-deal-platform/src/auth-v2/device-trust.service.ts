import { createHmac } from 'crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { DeviceContext } from './session.service';
import { EnvSecretsProvider, SECRETS_PROVIDER, type SecretsProvider } from './secrets.provider';

/**
 * Privacy-first device id (Slice 1 corrections):
 *
 *   Stable-ish inputs (only these enter HMAC):
 *     browserFamily | osFamily | browserId | pwaInstallId
 *       → canonicalize → HMAC-SHA256(DEVICE_HMAC_SECRET) → deviceId
 *
 *   Context signals (stored on session, for Risk Engine later — NOT in deviceId):
 *     timezone, locale/language
 *
 * browserId = browser storage id (not a user id)
 * pwaInstallId = this PWA installation id (not a user id)
 *
 * Does not use canvas/WebGL. Client fingerprintHash is ignored.
 */

/** Signals that define deviceId (stable-ish). */
export type StableDeviceSignals = {
  /** Parsed browser family (chrome, edge, …) — not a user identifier. */
  browserFamily: string;
  /** Parsed OS family — not a user identifier. */
  osFamily: string;
  /** Browser localStorage UUID — storage-scoped only. */
  browserId: string;
  /** PWA/standalone install UUID — installation-scoped only. */
  pwaInstallId: string;
};

/** Context for risk / audit — must not flip deviceId when user changes language/TZ. */
export type DeviceContextSignals = {
  timezone: string;
  locale: string;
};

export type CoarseDeviceSignals = StableDeviceSignals & DeviceContextSignals;

@Injectable()
export class DeviceTrustService {
  constructor(
    @Optional() @Inject(SECRETS_PROVIDER) secrets?: SecretsProvider,
  ) {
    this.secrets = secrets ?? new EnvSecretsProvider();
    // Fail fast in production if DEVICE_HMAC_SECRET is missing (no JWT_SECRET fallback).
    if (process.env.NODE_ENV === 'production' && !this.secrets.get('DEVICE_HMAC_SECRET')) {
      throw new Error('Missing required secret: DEVICE_HMAC_SECRET');
    }
  }

  private readonly secrets: SecretsProvider;

  /** Strip invasive / client-controlled trust fields; keep coarse labels + ids. */
  sanitizeDevice(device?: DeviceContext | null): DeviceContext {
    if (!device) return {};
    const {
      canvasHash: _c,
      webglHash: _w,
      fingerprintHash: _f,
      ...rest
    } = device;
    void _c;
    void _w;
    void _f;
    return { ...rest };
  }

  /**
   * Server-side deviceId for Session.fingerprintHash / TrustedDevice.
   * Returns null if stable signals are too empty to be useful.
   */
  resolveDeviceId(device?: DeviceContext | null): string | null {
    const clean = this.sanitizeDevice(device);
    const stable = this.extractStableSignals(clean);
    if (!this.hasMinimumStableSignals(stable)) return null;
    return this.hmacDeviceId(stable);
  }

  /** Full coarse bundle: stable for HMAC + context for Risk (Slice 2+). */
  extractCoarseSignals(device: DeviceContext): CoarseDeviceSignals {
    return {
      ...this.extractStableSignals(device),
      ...this.extractContextSignals(device),
    };
  }

  extractStableSignals(device: DeviceContext): StableDeviceSignals {
    const ua = device.userAgent ?? '';
    return {
      browserFamily: normalizeToken(device.browser) || browserFamilyFromUa(ua),
      osFamily: normalizeToken(device.os) || osFamilyFromUa(ua) || normalizeToken(device.platform),
      browserId: normalizeToken(device.browserId),
      pwaInstallId: normalizeToken(device.pwaInstallId),
    };
  }

  extractContextSignals(device: DeviceContext): DeviceContextSignals {
    return {
      timezone: normalizeToken(device.timezone),
      locale: normalizeToken(device.language),
    };
  }

  hmacDeviceId(signals: StableDeviceSignals): string {
    const canonical = [
      signals.browserFamily,
      signals.osFamily,
      signals.browserId,
      signals.pwaInstallId,
    ].join('|');
    return createHmac('sha256', this.deviceHmacSecret())
      .update(canonical, 'utf8')
      .digest('hex')
      .slice(0, 64);
  }

  private hasMinimumStableSignals(s: StableDeviceSignals): boolean {
    // Prefer a storage/install id; else need both family labels
    if (s.browserId || s.pwaInstallId) return true;
    return Boolean(s.browserFamily && s.osFamily);
  }

  private deviceHmacSecret(): string {
    const dedicated = this.secrets.get('DEVICE_HMAC_SECRET');
    if (dedicated) return dedicated;

    // Production: never bind device HMAC to JWT_SECRET (separate security domains).
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Missing required secret: DEVICE_HMAC_SECRET');
    }

    // Development only: JWT_SECRET → last-resort fixed string for local/tests.
    const jwt = this.secrets.get('JWT_SECRET');
    if (jwt) return jwt;
    return 'onix-dev-device-hmac-not-for-production';
  }
}

function normalizeToken(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().slice(0, 64);
}

export function browserFamilyFromUa(ua: string): string {
  const s = ua.toLowerCase();
  if (s.includes('edg/')) return 'edge';
  if (s.includes('opr/') || s.includes('opera')) return 'opera';
  if (s.includes('firefox/')) return 'firefox';
  if (s.includes('chrome/') || s.includes('crios/')) return 'chrome';
  if (s.includes('safari/') && !s.includes('chrome/')) return 'safari';
  return '';
}

export function osFamilyFromUa(ua: string): string {
  const s = ua.toLowerCase();
  if (s.includes('windows')) return 'windows';
  if (s.includes('android')) return 'android';
  if (s.includes('iphone') || s.includes('ipad') || s.includes('ios')) return 'ios';
  if (s.includes('mac os') || s.includes('macintosh')) return 'macos';
  if (s.includes('linux')) return 'linux';
  return '';
}
