import { useEffect, useState, type FormEvent } from 'react';
import { CATEGORIES, SUBCATEGORIES_BY_CATEGORY, SUBCATEGORY_LABELS, type ProductDraft } from '../api/contracts';
import { PLATFORM_VIDEO_RULE } from './platformCopy';
import { Button, Card, Field, Input, Textarea } from '../design-system';
import { minPriceRubles, validateDraft } from '../utils/productValidation';
import {
  NEW_SELLER_WARRANTY_MIN_HOURS,
  WARRANTY_DEFAULT_HOURS,
  clampListingWarranty,
  isNewSellerAccount,
  warrantyMinHoursForSeller,
} from '../utils/warranty';
import type { Core } from './types';
import { emptyDraft } from './shared';
import { categoryLabel } from '../i18n';

function sellerRegisteredAt(core: Core): string | null {
  return core.profile?.registeredAt
    ?? core.profile?.trustCard?.registeredAt
    ?? null;
}

export function ProductForm({ core, onDone, setToast }: { core: Core; onDone: () => void; setToast: (text: string) => void }) {
  const registeredAt = sellerRegisteredAt(core);
  const profileReady = core.states.profile === 'success' && Boolean(core.profile);
  const knownMature = Boolean(
    profileReady && registeredAt && !isNewSellerAccount(registeredAt),
  );
  const newSeller = !knownMature;
  const minWarranty = warrantyMinHoursForSeller(knownMature ? registeredAt : null);
  const [draft, setDraft] = useState<ProductDraft>(() => ({
    ...emptyDraft,
    warrantyHours: NEW_SELLER_WARRANTY_MIN_HOURS,
  }));
  const [errors, setErrors] = useState<string[]>([]);
  const [catsOpen, setCatsOpen] = useState(false);

  useEffect(() => {
    if (!profileReady) {
      setDraft((prev) => ({ ...prev, warrantyHours: NEW_SELLER_WARRANTY_MIN_HOURS }));
      return;
    }
    if (registeredAt && isNewSellerAccount(registeredAt)) {
      setDraft((prev) => ({
        ...prev,
        warrantyHours: clampListingWarranty(prev.warrantyHours ?? NEW_SELLER_WARRANTY_MIN_HOURS, registeredAt),
      }));
      return;
    }
    setDraft((prev) => {
      const current = prev.warrantyHours ?? WARRANTY_DEFAULT_HOURS;
      const next = current === NEW_SELLER_WARRANTY_MIN_HOURS ? WARRANTY_DEFAULT_HOURS : current;
      return {
        ...prev,
        warrantyHours: clampListingWarranty(next, registeredAt),
      };
    });
  }, [registeredAt, profileReady]);

  const catalog = core.catalogSubcategories ?? SUBCATEGORIES_BY_CATEGORY;
  const subs = catalog[draft.category] ?? catalog.OTHER ?? SUBCATEGORIES_BY_CATEGORY.OTHER;
  const minRub = minPriceRubles(draft.subcategory);
  const priceNum = Number(draft.priceRubles);
  const payout = Number.isFinite(priceNum) ? (priceNum * 0.95).toFixed(2) : null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = validateDraft(draft, { minWarrantyHours: minWarranty });
    setErrors(next);
    if (next.length) return;
    const payload = {
      ...draft,
      warrantyHours: clampListingWarranty(draft.warrantyHours ?? WARRANTY_DEFAULT_HOURS, registeredAt),
    };
    if (await core.createProduct(payload)) {
      setToast('Лот опубликован на витрине.');
      setDraft({
        ...emptyDraft,
        warrantyHours: newSeller ? NEW_SELLER_WARRANTY_MIN_HOURS : WARRANTY_DEFAULT_HOURS,
      });
      onDone();
    }
  };
  const pickCategory = (category: string) => {
    const nextSubs = catalog[category] ?? catalog.OTHER ?? SUBCATEGORIES_BY_CATEGORY.OTHER;
    setDraft({ ...draft, category, subcategory: nextSubs[0] });
  };
  const showNewSellerNote = !profileReady || newSeller;

  return <div className="stack narrow lot-form">
    <Card><form className="form" onSubmit={submit}>
      {errors.length > 0 && <div className="form-error" role="alert"><strong>Проверьте данные:</strong>{errors.map(item => <span key={item}>— {item}</span>)}</div>}
      {core.errors['product-form'] && <div className="form-error" role="alert"><strong>{core.errors['product-form']}</strong></div>}
      <Field label="Название" hint="До 32 символов"><Input required minLength={5} maxLength={32} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder="Например, Butterfly | Fade" /></Field>
      <Field label="Описание"><Textarea maxLength={20000} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></Field>
      <div className="field">
        <span className="field__label">Категория</span>
        <button
          type="button"
          className={`control category-toggle${catsOpen ? ' is-open' : ''}`}
          aria-expanded={catsOpen}
          aria-controls="lot-category-list"
          onClick={() => setCatsOpen((open) => !open)}
        >
          <span>{categoryLabel(draft.category)}</span>
        </button>
        {catsOpen && (
          <div id="lot-category-list" className="chips category-picker" role="list" aria-label="Все категории">
            {CATEGORIES.map((item) => (
              <button
                type="button"
                role="listitem"
                key={item}
                className={draft.category === item ? 'active' : ''}
                onClick={() => pickCategory(item)}
              >{categoryLabel(item)}</button>
            ))}
          </div>
        )}
      </div>
      <Field label="Подкатегория">
        <div className="chips" role="list" aria-label="Подкатегории">
          {subs.map(item => (
            <button
              type="button"
              role="listitem"
              className={draft.subcategory === item ? 'active' : ''}
              key={item}
              onClick={() => setDraft({ ...draft, subcategory: item })}
            >{(SUBCATEGORY_LABELS[item] ?? item).toUpperCase()}</button>
          ))}
        </div>
      </Field>
      <div className="form-grid"><Field label="Цена, ₽" hint={`От ${minRub} ₽ · комиссия 5%`}><Input required inputMode="decimal" value={draft.priceRubles} onChange={event => setDraft({ ...draft, priceRubles: event.target.value })} /></Field>
        <Field label="Количество"><Input required type="number" min={1} max={999} value={draft.quantity} onChange={event => setDraft({ ...draft, quantity: Number(event.target.value) })} /></Field></div>
      <label className="check-row"><input type="checkbox" checked={Boolean(draft.autoDeliver)} onChange={event => setDraft({ ...draft, autoDeliver: event.target.checked })} /> Автоматическая выдача</label>
      {draft.autoDeliver && <Field label="Текст товара" hint="login / password / код / ссылка — выдаётся только после оплаты"><Textarea required maxLength={4000} value={draft.deliveryText || ''} onChange={event => setDraft({ ...draft, deliveryText: event.target.value })} /></Field>}
      <Field
        label="Заморозка денег продавца"
        hint={showNewSellerNote
          ? `Пока аккаунту меньше 7 дней, деньги после продажи заморожены минимум на ${minWarranty} ч. Короче поставить нельзя.`
          : 'Сколько часов после передачи товара деньги ещё не уходят продавцу (от 5 часов до 30 дней, по умолчанию 10).'}
      >
        <Input
          type="number"
          min={minWarranty}
          max={720}
          value={draft.warrantyHours ?? minWarranty}
          onChange={(event) => setDraft({
            ...draft,
            warrantyHours: clampListingWarranty(Number(event.target.value), registeredAt),
          })}
        />
      </Field>
      <p className="muted">{PLATFORM_VIDEO_RULE}</p>
      <label className="check-row">
        <input
          type="checkbox"
          checked={Boolean(draft.acceptedRules)}
          onChange={(event) => setDraft({ ...draft, acceptedRules: event.target.checked })}
        />
        Я прочитал и согласен с правилами платформы
      </label>
      {core.profile && core.profile.hasTelegram === false && (
        <p className="form-error" role="alert">Чтобы продавать, привяжите Telegram в профиле. Через Google можно только покупать.</p>
      )}
      <div className="summary-line"><span>К получению (после 5%)</span><strong>{payout ? `${payout} ₽` : '—'}</strong></div>
      <Button type="submit" variant="violet" busy={core.actionBusy === 'product-form'} disabled={core.profile?.hasTelegram === false}>ОПУБЛИКОВАТЬ ЛОТ</Button>
      {showNewSellerNote ? (
        <p className="muted lot-form__new-seller-note">
          Аккаунту меньше 7 дней: срок заморозки денег при выставлении лота — минимум 24 часа.
          Это и есть гарантия покупателю в безопасной сделке: пока идёт этот срок, выплата продавцу не завершается.
          Отдельной блокировки баланса «ещё на сутки» после выплаты нет. Через 7 дней с регистрации можно ставить от 5 часов.
        </p>
      ) : null}
    </form></Card></div>;
}
export default ProductForm;
