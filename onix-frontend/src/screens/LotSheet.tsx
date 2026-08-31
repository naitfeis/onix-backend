import { useEffect, useRef, useState } from 'react';
import { api, friendlyError, money } from '../api/client';
import {
  API_PATHS, CATEGORY_LABELS, SUBCATEGORY_LABELS, type Product, type TrustCard,
} from '../api/contracts';
import { Button } from '../design-system';
import {
  LOT_PAY_METHODS, lotDisplayTitle, lotPayMethodLabel, lotPayMethodMeta, parseCents, quoteLotCheckout,
  type LotPayMethod,
} from '../utils/lotCheckout';
import type { Core } from './types';
import { SellerIdentityCard } from './SellerIdentityCard';

const PAYMENT_WARNING =
  'Не подтверждайте заказ, пока продавец не передал товар. Снимите передачу на видео — так проще решить спор.';
const SAFE_NOTE =
  'Деньги не уходят продавцу сразу: они хранятся на платформе, пока вы не подтвердите, что товар получен.';

function PayMethodRow({
  method,
  value,
  open,
  active,
  onClick,
}: {
  method: LotPayMethod;
  value: string;
  open?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  const meta = lotPayMethodMeta(method);
  return (
    <button type="button" className={`lot-pay-option${open ? ' is-open' : ''}${active ? ' is-active' : ''}`} onClick={onClick}>
      <span className="lot-pay-option__icon" aria-hidden="true">{meta.icon}</span>
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
}: {
  product: Product;
  detailReady: boolean;
  trust: TrustCard | null;
  core: Core;
  buying: boolean;
  backLabel: string;
  onBack: () => void;
  onBuy: () => Promise<void> | void;
  onOpenSeller: () => void;
  onWrite: () => void;
  onToast: (text: string) => void;
}) {
  const [method, setMethod] = useState<LotPayMethod>('BALANCE');
  const [methodsOpen, setMethodsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const payLockRef = useRef(false);
  const intentKeyRef = useRef(crypto.randomUUID());
  const toppedUpRef = useRef(false);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const balanceCents = parseCents(core.profile?.balanceCents);
  const priceCents = parseCents(product.priceCents);
  const lot = product.lotNumber != null ? `ONIXLOT-${product.lotNumber}` : null;
  const canBuy = product.status === 'ACTIVE' && Boolean(core.profile);
  const categoryLabel = CATEGORY_LABELS[product.category] ?? product.category;
  const subLabel = product.subcategory
    ? (SUBCATEGORY_LABELS[product.subcategory] ?? product.subcategory)
    : '';
  const activeMethod = LOT_PAY_METHODS.includes(method) ? method : 'BALANCE';
  const activeQuote = quoteLotCheckout(priceCents, balanceCents, activeMethod);
  const title = lotDisplayTitle(product);
  const detail = !detailReady
    ? 'Загрузка описания…'
    : (product.description?.trim() || 'Продавец не добавил описание.');
  const activeMeta = lotPayMethodMeta(activeMethod);
  const pickerValue = activeMethod === 'BALANCE'
    ? money(String(balanceCents))
    : activeMeta.live
      ? (activeQuote.remainingCents > 0 ? `Сбор ${activeQuote.feeBps / 100}%` : 'Без сбора')
      : 'Тест';

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onBackRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = async () => {
    if (payLockRef.current || busy) return;
    if (!canBuy) {
      onToast('Войдите, чтобы купить лот.');
      return;
    }
    if (!activeMeta.live && !activeQuote.coveredByBalance) {
      onToast('Этот способ пока тестовый. Выберите баланс, СБП или карту.');
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
        });
        await api.post(API_PATHS.paymentIntentConfirm(intent.id), {});
        toppedUpRef.current = true;
        await core.loadProfile();
      }
      await onBuy();
    } catch (error) {
      onToast(friendlyError(error));
    } finally {
      payLockRef.current = false;
      setBusy(false);
    }
  };

  return (
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
            <span className="lot-sheet__badge">{categoryLabel}</span>
            {subLabel ? <span className="lot-sheet__badge">{subLabel}</span> : null}
            <span className={`lot-sheet__badge${product.autoDeliver ? ' lot-sheet__badge--auto' : ''}`}>
              {product.autoDeliver ? '⚡ Автовыдача' : 'Без автовыдачи'}
            </span>
          </div>
        </div>

        <section className="lot-island" aria-label="Название и описание">
          <p className="lot-sheet__section">Название</p>
          <p className="lot-sheet__title">{title}</p>
          <p className="lot-sheet__section lot-sheet__section--next">Описание</p>
          <p className="lot-sheet__detail">{detail}</p>
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
              onClick={() => setMethodsOpen((open) => !open)}
            />
            {methodsOpen && (
              <div className="lot-pay-picker__list" role="list">
                {LOT_PAY_METHODS.filter((item) => item !== activeMethod).map((item) => {
                  const meta = lotPayMethodMeta(item);
                  const value = item === 'BALANCE'
                    ? money(String(balanceCents))
                    : meta.live
                      ? `Сбор ${quoteLotCheckout(priceCents, balanceCents, item).feeBps / 100}%`
                      : 'Тест';
                  return (
                    <PayMethodRow
                      key={item}
                      method={item}
                      value={value}
                      onClick={() => {
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
            Нажимая «Купить», вы соглашаетесь с правилами площадки и политикой возвратов.
          </p>
          <p className="lot-sheet__warn">{PAYMENT_WARNING}</p>
          <p className="lot-sheet__warn">{SAFE_NOTE}</p>
        </section>
      </div>
    </div>
  );
}
