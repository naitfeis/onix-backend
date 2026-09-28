/**
 * Live availability of PSP methods.
 *
 * Source of truth is GET /api/payments/methods (public, cached 30s by the API).
 * The UI must not advertise СБП / card before the backend confirms acquiring
 * credentials — otherwise a buyer walks the whole checkout and ends on a 403
 * from the provider.
 */
import { API_PATHS, type PaymentMethodsPublic } from './contracts';

export type PaymentMethodsAvailability = PaymentMethodsPublic;

/** Conservative default: balance only until the API answers. */
export const PAYMENT_METHODS_UNKNOWN: PaymentMethodsAvailability = {
  sbp: false,
  card: false,
  sandbox: false,
};

let cached: PaymentMethodsAvailability | null = null;
let inflight: Promise<PaymentMethodsAvailability> | null = null;

function normalize(payload: unknown): PaymentMethodsAvailability {
  const row = (payload ?? {}) as Partial<PaymentMethodsAvailability>;
  return {
    sbp: row.sbp === true,
    card: row.card === true,
    sandbox: row.sandbox === true,
  };
}

/** Cached + single-flight: many screens mount at once, one HTTP call. */
export async function fetchPaymentMethods(
  get: <T>(path: string) => Promise<T>,
): Promise<PaymentMethodsAvailability> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const next = normalize(await get<unknown>(API_PATHS.paymentsMethods));
      cached = next;
      return next;
    } catch {
      // Offline / API blip: keep the safe "balance only" default.
      return PAYMENT_METHODS_UNKNOWN;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function cachedPaymentMethods(): PaymentMethodsAvailability {
  return cached ?? PAYMENT_METHODS_UNKNOWN;
}

/** Test helper — clears the memo between cases. */
export function resetPaymentMethodsCache(): void {
  cached = null;
  inflight = null;
}