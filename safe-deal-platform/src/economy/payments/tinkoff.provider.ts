import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  CreatePaymentIntentInput,
  PaymentProvider,
  ProviderCreateResult,
  ProviderWebhookVerification,
} from './payment-provider';
import { PrismaService } from '../../prisma.service';

const DEFAULT_API = 'https://securepay.tinkoff.ru/v2';

export function tinkoffToken(payload: Record<string, unknown>, password: string): string {
  const flat: Record<string, string> = { Password: password };
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'Token' || value == null) continue;
    if (typeof value === 'object') continue;
    if (typeof value === 'boolean') flat[key] = value ? 'true' : 'false';
    else flat[key] = String(value);
  }
  const concat = Object.keys(flat).sort().map((key) => flat[key]).join('');
  return createHash('sha256').update(concat).digest('hex');
}

export function tinkoffCredentials(env: NodeJS.ProcessEnv = process.env): {
  terminalKey: string;
  password: string;
  apiBase: string;
} | null {
  const terminalKey = env.TINKOFF_TERMINAL_KEY?.trim() || env.TBANK_TERMINAL_KEY?.trim() || '';
  const password = env.TINKOFF_PASSWORD?.trim() || env.TBANK_PASSWORD?.trim() || '';
  if (!terminalKey || !password) return null;
  const apiBase = (env.TINKOFF_API_URL?.trim() || DEFAULT_API).replace(/\/$/, '');
  return { terminalKey, password, apiBase };
}

type TinkoffInitResponse = {
  Success?: boolean;
  ErrorCode?: string;
  Message?: string;
  Details?: string;
  PaymentId?: string | number;
  PaymentURL?: string;
  Status?: string;
};

/**
 * T-Bank Acquiring (sandbox or live). Same adapter is registered as YOOKASSA (СБП)
 * and CARD until dedicated enum values exist — frontend already sends those codes.
 */
@Injectable()
export class TinkoffAcquiringProvider implements PaymentProvider {
  readonly code = 'YOOKASSA' as const;
  readonly createIntentIsIdempotent = true as const;
  private readonly log = new Logger(TinkoffAcquiringProvider.name);

  constructor(private readonly prisma: PrismaService) {}

  isConfigured(): boolean {
    return tinkoffCredentials() != null;
  }

  async createIntent(input: CreatePaymentIntentInput): Promise<ProviderCreateResult> {
    const creds = tinkoffCredentials();
    if (!creds) {
      throw new ForbiddenException(
        'СБП и карта: задайте TINKOFF_TERMINAL_KEY и TINKOFF_PASSWORD (sandbox Т-Банка) в переменных API.',
      );
    }
    const payWay = input.metadata?.payWay === 'card' ? 'card' : 'sbp';
    const amount = Number(input.amountCents);
    const body: Record<string, unknown> = {
      TerminalKey: creds.terminalKey,
      Amount: amount,
      OrderId: input.idempotencyKey,
      Description: payWay === 'sbp' ? 'ONIX пополнение СБП' : 'ONIX пополнение картой',
      Language: 'ru',
    };
    body.Token = tinkoffToken(body, creds.password);
    const init = await this.postJson<TinkoffInitResponse>(`${creds.apiBase}/Init`, body);
    if (!init.Success || !init.PaymentId) {
      throw new ForbiddenException(init.Message || init.Details || 'Т-Банк отклонил создание платежа.');
    }
    const paymentId = String(init.PaymentId);
    let qrPayload: string | undefined;
    if (payWay === 'sbp') {
      try {
        const qrReq: Record<string, unknown> = {
          TerminalKey: creds.terminalKey,
          PaymentId: paymentId,
          DataType: 'PAYLOAD',
        };
        qrReq.Token = tinkoffToken(qrReq, creds.password);
        const qr = await this.postJson<{ Success?: boolean; Data?: string }>(`${creds.apiBase}/GetQr`, qrReq);
        if (qr.Success && qr.Data) qrPayload = qr.Data;
      } catch (error) {
        this.log.warn(`GetQr skipped: ${error instanceof Error ? error.message : 'error'}`);
      }
    }
    return {
      status: 'PENDING',
      providerRef: paymentId,
      metadata: {
        channel: 'tinkoff',
        payWay,
        paymentUrl: init.PaymentURL ?? null,
        paymentId,
        qrPayload: qrPayload ?? null,
        sandbox: (process.env.TINKOFF_SANDBOX ?? 'true').trim() !== 'false',
      },
    };
  }

  async confirmIntent() {
    return { status: 'PENDING' as const };
  }

  async verifyWebhook(
    _headers: Record<string, string | string[] | undefined>,
    rawBody: string,
  ): Promise<ProviderWebhookVerification> {
    const creds = tinkoffCredentials();
    if (!creds) return { ok: false };
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return { ok: false };
    }
    const given = String(payload.Token ?? '');
    const expected = tinkoffToken(payload, creds.password);
    if (!given || given.toLowerCase() !== expected.toLowerCase()) {
      return { ok: false };
    }
    const orderId = String(payload.OrderId ?? '');
    const paymentId = String(payload.PaymentId ?? '');
    if (!orderId || !paymentId) return { ok: false };
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { idempotencyKey: orderId },
      select: { id: true, amountCents: true, currency: true },
    });
    if (!intent) return { ok: false };
    const statusRaw = String(payload.Status ?? '').toUpperCase();
    let status: 'SUCCEEDED' | 'FAILED' | 'CANCELED' | undefined;
    if (statusRaw === 'CONFIRMED' || statusRaw === 'AUTHORIZED') {
      status = 'SUCCEEDED';
    } else if (statusRaw === 'REJECTED' || statusRaw === 'DEADLINE_EXPIRED') {
      status = 'FAILED';
    } else if (statusRaw === 'CANCELED' || statusRaw === 'REVERSED' || statusRaw === 'REFUNDED') {
      status = 'CANCELED';
    } else {
      return { ok: false };
    }
    const claimed = payload.Amount != null ? BigInt(String(payload.Amount)) : undefined;
    return {
      ok: true,
      eventId: `${paymentId}:${statusRaw}`,
      providerPaymentId: paymentId,
      intentId: intent.id,
      status,
      claimedAmountCents: claimed,
      claimedCurrency: intent.currency,
    };
  }

  private async postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await response.json() as T;
    return json;
  }
}
