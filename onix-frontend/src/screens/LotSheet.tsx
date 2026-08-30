import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, friendlyError, money } from '../api/client';
import {
  API_PATHS, CATEGORY_LABELS, SUBCATEGORY_LABELS, type Product, type TrustCard,
} from '../api/contracts';
import { Button } from '../design-system';
import { popModal, pushModal } from '../design-system/modalStack';
import {
  lotDisplayTitle, lotPayMethodLabel, lotShortDescription, parseCents, quoteLotCheckout, type LotPayMethod,
} from '../utils/lotCheckout';
import type { Core } from './types';
import { SellerIdentityCard } from './SellerIdentityCard';

const PAYMENT_WARNING =
  'Не подтверждайте заказ, пока продавец не передал товар. Снимите передачу на видео — так проще решить спор.';
const SAFE_NOTE =
  'Деньги не уходят продавцу сразу: они хранятся на платформе, пока вы не подтвердите, что товар получен.';
const LOT_FEE_LABEL: Record<Exclude<LotPayMethod, 'BALANCE'>, string> = {
  SBP: '1%',
  CARD: '4%',
};

export function LotSheet({
  product,
  detailReady,
  trust,
  core,
  buying,
  backLabel,
  suppressed,
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
  suppressed?: boolean;
  onBack: () => void;
  onBuy: () => Promise<void> | void;
  onOpenSeller: () => void;
  onWrite: () => void;
  onToast: (text: string) => void;
}) {
  const [method, setMethod] = useState<LotPayMethod>('BALANCE');
  const [methodsOpen, setMethodsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const balanceCents = parseCents(core.profile?.balanceCents);
  const priceCents = parseCents(product.priceCents);
  const quote = quoteLotCheckout(priceCents, balanceCents, method);
  const lot = product.lotNumber != null ? `ONIXLOT-${product.lotNumber}` : null;
  const canBuy = product.status === 'ACTIVE' && Boolean(core.profile);
  const categoryLabel = CATEGORY_LABELS[product.category] ?? product.category;
  const subLabel = product.subcategory
    ? (SUBCATEGORY_LABELS[product.subcategory] ?? product.subcategory)
    : '';
  const payOptions: LotPayMethod[] = quote.coveredByBalance ? ['BALANCE'] : ['SBP', 'CARD'];
  const activeMethod = payOptions.includes(method) ? method : payOptions[0]!;
  const activeQuote = quoteLotCheckout(priceCents, balanceCents, activeMethod);
  const title = lotDisplayTitle(product);
  const summary = lotShortDescription(product);
  const detail = !detailReady
    ? 'Загрузка описания…'
    : (product.description?.trim() || 'Продавец не добавил описание.');

  useEffect(() => {
    const { id } = pushModal(() => onBackRef.current());
    document.body.classList.add('lot-sheet-open');
    return () => {
      popModal(id);
      document.body.classList.remove('lot-sheet-open');
    };
  }, []);

  const submit = async () => {
    if (!canBuy) {
      onToast('Войдите, чтобы купить лот.');
      return;
    }
    setBusy(true);
    try {
      if (!activeQuote.coveredByBalance) {
        const intent = await api.post<{ id: string }>(API_PATHS.paymentsIntents, {
          wallet: 'MAIN',
          amountCents: activeQuote.externalCents,
          provider: activeMethod === 'CARD' ? 'CARD' : 'YOOKASSA',
          idempotencyKey: crypto.randomUUID(),
        });
        await api.post(API_PATHS.paymentIntentConfirm(intent.id), {});
        await core.loadProfile();
      }
      await onBuy();
    } catch (error) {
      onToast(friendlyError(error));
    } finally {
      setBusy(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`lot-sheet${suppressed ? ' lot-sheet--suppressed' : ''}`}
      role="dialog"
      aria-modal={!suppressed}
      aria-hidden={suppressed || undefined}
      aria-label={title}
    >
      <div className="lot-sheet__bar">
        <Button type="button" variant="secondary" onClick={onBack}>{backLabel}</Button>
        {lot && <span className="onixlot-id">{lot}</span>}
      </div>
      <div className="lot-sheet__body">
        <div className="lot-sheet__hero">
          <p className="lot-sheet__kicker">Оформление заказа</p>
          <div className="lot-sheet__badges">
            <span className="lot-sheet__badge">{categoryLabel}</span>
            {subLabel ? <span className="lot-sheet__badge">{subLabel}</span> : null}
            {product.warrantyLabel ? <span className="lot-sheet__badge">{product.warrantyLabel}</span> : null}
          </div>
        </div>
        <div className="lot-sheet__split">
          <section className="lot-sheet__col lot-sheet__col--profile" aria-label="Продавец">
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
          <section className="lot-sheet__col lot-sheet__col--pay" aria-label="Оплата">
            <p className="lot-sheet__section">Название</p>
            <p className="lot-sheet__title">{title}</p>
            <p className="lot-sheet__section">Краткое описание</p>
            <p className="lot-sheet__summary">{summary}</p>
            <p className="lot-sheet__summary-price">{money(product.priceCents)}</p>
            <p className="lot-sheet__section">Подробное описание</p>
            <p className="lot-sheet__detail">{detail}</p>
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
            <p className="lot-sheet__section">Способ оплаты</p>
            <div className="lot-pay-picker">
              <button
                type="button"
                className="lot-pay-picker__btn"
                aria-expanded={methodsOpen}
                onClick={() => setMethodsOpen((open) => !open)}
              >
                <span>{lotPayMethodLabel(activeMethod)}</span>
                <b>
                  {activeQuote.coveredByBalance
                    ? money(String(balanceCents))
                    : `${activeQuote.feeBps / 100}% сбор`}
                </b>
              </button>
              {methodsOpen && (
                <div className="lot-pay-picker__list" role="list">
                  {payOptions.map((item) => (
                    <button
                      key={item}
                      type="button"
                      role="listitem"
                      className={item === activeMethod ? 'active' : ''}
                      onClick={() => {
                        setMethod(item);
                        setMethodsOpen(false);
                      }}
                    >
                      {lotPayMethodLabel(item)}
                      {item !== 'BALANCE' ? ` · сбор ${LOT_FEE_LABEL[item]}` : ' · без сбора'}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="lot-sheet__buy">
              <Button
                variant="buy"
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
    </div>,
    document.body,
  );
}
