import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, friendlyError, money } from '../api/client';
import {
  API_PATHS, SUBCATEGORY_LABELS, type Product, type TrustCard,
} from '../api/contracts';
import { Button } from '../design-system';
import { popModal, pushModal } from '../design-system/modalStack';
import {
  BALANCE_ONLY_AVAILABILITY, LOT_PAY_METHODS, isPayMethodLive, lotDisplayTitle, lotPayMethodLabel,
  lotPayMethodMeta, parseCents, quoteLotCheckout, type LotPayAvailability, type LotPayMethod,
} from '../utils/lotCheckout';
import PaymentCheckout from './PaymentCheckout';
import type { Core } from './types';
import { SellerIdentityCard } from './SellerIdentityCard';
import { lotWarrantyBadge } from '../utils/warranty';
import { CardLogo, OnixPayMark, SbpLogo } from '../components/BrandLogos';
import { categoryLabel as displayCategory } from '../i18n';
import { FormattedDescription } from '../utils/formattedDescription';

const PAYMENT_WARNING =
  'Не подтверждайте заказ, пока продавец не передал товар. Снимите передачу на видео — так проще решить спор.';
const SAFE_NOTE =
  'Деньги не уходят продавцу сразу: они хранятся на платформе, пока вы не подтвердите, что товар получен.';

function PayMethodIcon({ kind }: { kind: 'onix' | 'sbp' | 'card' }) {
  if (kind === 'sbp') return <SbpLogo />;
  if (kind === 'card') return <CardLogo />;
  return <OnixPayMark />;
}

function PayMethodRow({
  method,
  value,
  open,
  active,
  availability,
  onClick,
}: {
  method: LotPayMethod;
  value: string;
  open?: boolean;
  active?: boolean;
  availability?: LotPayAvailability;
  onClick: () => void;
}) {
  const meta = lotPayMethodMeta(method, availability ?? BALANCE_ONLY_AVAILABILITY);
  const disabled = !meta.live;
  return (
    <button
      type="button"
      className={`lot-pay-option${open ? ' is-open' : ''}${active ? ' is-active' : ''}${disabled ? ' is-unavailable' : ''}`}
      disabled={disabled}
      aria-disabled={disabled}
      onClick={onClick}
    >
      <span className="lot-pay-option__icon" aria-hidden="true">
        <PayMethodIcon kind={meta.icon} />
      </span>
      <span className="lot-pay-option__text">
        <b>{meta.title}</b>
        <small>{meta.hint}</small>
      </span>
      <b className="lot-pay-option__value">{value}</b>
      {open != null && <span className="lot-pay-option__chevron" aria-hidden="true">{open ? '▲' : '▼'}</span>}
    </button>
  );
}

export function LotSheet({
  product,
  detailReady,
  trust,
  core,
  buying,
  backLabel,
  onBack,
  onBuy,
  onOpenSeller,
  onWrite,
  onToast,
  onRequestLogin,
}: {
  product: Product;
  detailReady: boolean;
  trust: TrustCard | null;
  core: Core;
  buying: boolean;
  backLabel: string;
  onBack: () => void;
  onBuy: (purchaseKey?: string) => Promise<void> | void;
  onOpenSeller: () => void;
  onWrite: () => void;
  onToast: (text: string) => void;
  onRequestLogin?: () => void;
}) {
  const [method, setMethod] = useState<LotPayMethod>('BALANCE');
  const [methodsOpen, setMethodsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [payIntentId, setPayIntentId] = useState<string | null>(null);
  const payLockRef = useRef(false);
  const intentKeyRef = useRef(crypto.randomUUID());
  const purchaseKeyRef = useRef(crypto.randomUUID());
  const toppedUpRef = useRef(false);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const balanceCents = parseCents(core.profile?.balanceCents);
  const priceCents = parseCents(product.priceCents);
  const lot = product.lotNumber != null ? `ONIXLOT-${product.lotNumber}` : null;
  const canBuy = product.status === 'ACTIVE' && Boolean(core.profile);
  const categoryName = displayCategory(product.category);
  const subLabel = product.subcategory
    ? (SUBCATEGORY_LABELS[product.subcategory] ?? product.subcategory)
    : '';
  const availability = useMemo(
    () => ({ sbp: core.paymentMethods.sbp, card: core.paymentMethods.card }),
    [core.paymentMethods],
  );
  const requestedMethod = LOT_PAY_METHODS.includes(method) ? method : 'BALANCE';
  /**
   * An unavailable PSP must not stay selected: if acquiring is not configured
   * (or just went down) fall back to balance instead of letting the buyer hit
   * a provider 403 at the very end of checkout.
   */
  const activeMethod: LotPayMethod = isPayMethodLive(requestedMethod, availability)
    ? requestedMethod
    : 'BALANCE';
  const activeQuote = quoteLotCheckout(priceCents, balanceCents, activeMethod);
  const title = lotDisplayTitle(product);
  const detail = !detailReady
    ? 'Загрузка описания…'
    : (product.description?.trim() || 'Продавец не добавил описание.');
  const activeMeta = lotPayMethodMeta(activeMethod, availability);

  useEffect(() => {
    if (requestedMethod === activeMethod) return;
    setMethod(activeMethod);
  }, [activeMethod, requestedMethod]);

  const pickerValue = activeMethod === 'BALANCE'
    ? money(String(balanceCents))
    : activeQuote.remainingCents > 0 ? `Сбор ${activeQuote.feeBps / 100}%` : 'Без сбора';

  /**
   * Escape / Telegram BackButton / body-lock go through the shared modal stack
   * so the sheet behaves like every other dialog. Without it the hardware back
   * gesture closed the whole Mini App mid-checkout and lost the purchase.
   */
  useEffect(() => {
    // lockBody: false — the sheet replaces the catalog and scrolls with the
    // page, so a body overflow lock would freeze it.
    const { id } = pushModal(() => onBackRef.current(), { lockBody: false });
    return () => popModal(id);
  }, []);

  const submit = async () => {
    if (payLockRef.current || busy) return;
    if (!canBuy) {
      onToast('Войдите, чтобы купить лот.');
      onRequestLogin?.();
      return;
    }
    if (!activeMeta.live && !activeQuote.coveredByBalance) {
      // PSP went unavailable after the sheet rendered — refresh and ask again.
      void core.loadPaymentMethods();
      onToast('Этот способ оплаты сейчас недоступен. Выберите баланс или другой способ.');
      return;
    }
    payLockRef.current = true;
    setBusy(true);
    try {
      if (!activeQuote.coveredByBalance && !toppedUpRef.current) {
        const intent = await api.post<{ id: string }>(API_PATHS.paymentsIntents, {
          wallet: 'MAIN',
          amountCents: activeQuote.externalCents,
          provider: activeMethod === 'CARD' ? 'CARD' : 'YOOKASSA',
          idempotencyKey: intentKeyRef.current,
          checkout: {
            productId: product.id,
            quantity: 1,
            purchaseIdempotencyKey: purchaseKeyRef.current,
          },
        });
        setPayIntentId(intent.id);
        return;
      }
      await onBuy(purchaseKeyRef.current);
    } catch (error) {
      if (await handleQuoteStale(error)) return;
      onToast(friendlyError(error));
    } finally {
      payLockRef.current = false;
      setBusy(false);
    }
  };

  /**
   * CHECKOUT_QUOTE_STALE / CHECKOUT_BALANCE_SUFFICIENT: the balance or price
   * moved after the sheet rendered. Re-quote from a fresh profile and tell the
   * buyer what changed instead of making them reload the whole screen.
   * Returns true when the error was consumed.
   */
  const handleQuoteStale = async (error: unknown): Promise<boolean> => {
    if (!(error instanceof ApiError)) return false;
    const details = error.details as { code?: string; expectedExternalCents?: string } | undefined;
    const code = details?.code;
    if (code !== 'CHECKOUT_QUOTE_STALE' && code !== 'CHECKOUT_BALANCE_SUFFICIENT') return false;
    // loadProfile resolves with the fresh profile — reading core.profile here
    // would see the pre-refresh closure value.
    const fresh = await core.loadProfile();
    const freshBalance = parseCents(fresh?.balanceCents ?? '0');
    const freshQuote = quoteLotCheckout(priceCents, freshBalance, activeMethod);
    if (code === 'CHECKOUT_BALANCE_SUFFICIENT' || freshQuote.coveredByBalance) {
      onToast('Баланс обновился — теперь лот оплачивается полностью с баланса. Нажмите «Купить» ещё раз.');
      return true;
    }
    // New external amount: a brand-new intent key so the stale claim is not reused.
    intentKeyRef.current = crypto.randomUUID();
    onToast(`Сумма к оплате изменилась: ${money(String(freshQuote.externalCents))}. Нажмите «Оплатить» ещё раз.`);
    return true;
  };

  return (
    <>
    <div className="lot-sheet" role="region" aria-label={title}>
      <div className="lot-sheet__bar">
        <button type="button" className="lot-sheet__back" onClick={onBack}>
          ← {backLabel}
        </button>
        {lot && <span className="onixlot-id">{lot}</span>}
      </div>
      <div className="lot-sheet__body">
        <div className="lot-sheet__hero">
          <p className="lot-sheet__kicker">Оформление заказа</p>
          <div className="lot-sheet__badges">
            <span className="lot-sheet__badge">{categoryName}</span>
            {subLabel ? <span className="lot-sheet__badge">{subLabel}</span> : null}
            <span className={`lot-sheet__badge${product.autoDeliver ? ' lot-sheet__badge--auto' : ''}`}>
              {product.autoDeliver ? '⚡ Автовыдача' : 'Без автовыдачи'}
            </span>
            <span className="lot-sheet__badge">{lotWarrantyBadge(product)}</span>
          </div>
        </div>

        <section className="lot-island" aria-label="Название и описание">
          <p className="lot-sheet__section">Название</p>
          <p className="lot-sheet__title">{title}</p>
          <p className="lot-sheet__section lot-sheet__section--next">Описание</p>
          <p className="lot-sheet__detail"><FormattedDescription text={detail} /></p>
        </section>

        <section className="lot-island lot-island--seller" aria-label="Продавец">
          <p className="lot-sheet__section">Продавец</p>
          <SellerIdentityCard
            seller={product.seller}
            trust={trust}
            core={core}
            checkout
            onOpen={onOpenSeller}
            onWrite={onWrite}
          />
        </section>

        <section className="lot-island" aria-label="Сумма заказа">
          <p className="lot-sheet__section">Сумма заказа</p>
          <div className="lot-checkout">
            <div className="lot-checkout__row"><span>Цена товара</span><b>{money(String(activeQuote.priceCents))}</b></div>
            <div className="lot-checkout__row"><span>Уже на балансе</span><b>{money(String(activeQuote.fromBalanceCents))}</b></div>
            <div className="lot-checkout__row">
              <span>Осталось оплатить</span>
              <b>{money(String(activeQuote.remainingCents))}</b>
            </div>
            <div className="lot-checkout__row">
              <span>
                Сервисный сбор
                {activeQuote.remainingCents > 0 ? ` · ${lotPayMethodLabel(activeMethod)} ${activeQuote.feeBps / 100}%` : ''}
              </span>
              <b>{money(String(activeQuote.feeCents))}</b>
            </div>
            <div className="lot-checkout__due">
              <small>К оплате {activeQuote.coveredByBalance ? 'с баланса' : 'сейчас'}</small>
              <strong>{money(String(activeQuote.coveredByBalance ? activeQuote.priceCents : activeQuote.externalCents))}</strong>
            </div>
          </div>
        </section>

        <section className="lot-island" aria-label="Способ оплаты">
          <p className="lot-sheet__section">Способ оплаты</p>
          <div className="lot-pay-picker">
            <PayMethodRow
              method={activeMethod}
              value={pickerValue}
              open={methodsOpen}
              availability={availability}
              onClick={() => setMethodsOpen((open) => !open)}
            />
            {methodsOpen && (
              <div className="lot-pay-picker__list" role="list">
                {LOT_PAY_METHODS.filter((item) => item !== activeMethod).map((item) => {
                  const meta = lotPayMethodMeta(item, availability);
                  const value = item === 'BALANCE'
                    ? money(String(balanceCents))
                    : meta.live
                      ? `Сбор ${quoteLotCheckout(priceCents, balanceCents, item).feeBps / 100}%`
                      : 'Недоступно';
                  return (
                    <PayMethodRow
                      key={item}
                      method={item}
                      value={value}
                      availability={availability}
                      onClick={() => {
                        if (!meta.live) return;
                        setMethod(item);
                        setMethodsOpen(false);
                      }}
                    />
                  );
                })}
              </div>
            )}
          </div>
          <div className="lot-sheet__buy">
            <Button
              variant="violet"
              busy={busy || buying}
              disabled={!canBuy}
              onClick={() => void submit()}
            >
              {activeQuote.coveredByBalance
                ? `Купить за ${money(String(activeQuote.priceCents))}`
                : `Оплатить остаток ${money(String(activeQuote.externalCents))}`}
            </Button>
          </div>
          <p className="lot-sheet__legal">
            Нажимая «Купить», вы соглашаетесь с{' '}
            <a href="/rules.html">правилами площадки</a> и{' '}
            <a href="/rules.html#refund-policy">политикой возвратов</a>.
          </p>
          <p className="lot-sheet__warn">{PAYMENT_WARNING}</p>
          <p className="lot-sheet__warn">{SAFE_NOTE}</p>
        </section>
      </div>
    </div>
    <PaymentCheckout
      intentId={payIntentId}
      onCancel={() => setPayIntentId(null)}
      onDone={() => {
        void (async () => {
          toppedUpRef.current = true;
          setPayIntentId(null);
          await core.loadProfile();
          await onBuy(purchaseKeyRef.current);
        })();
      }}
    />
    </>
  );
}
