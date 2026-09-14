import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { CATEGORIES, SUBCATEGORIES_BY_CATEGORY, SUBCATEGORY_LABELS, type ProductDraft } from '../api/contracts';
import { Button, Card, Field, Input } from '../design-system';
import { DescriptionEditor, type DescAlign, type DescFont } from '../components/DescriptionEditor';
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

const NEW_SELLER_HOLD_HINT =
  'Для безопасности новых пользователей средства с аккаунтов младше 7 дней становятся доступны для вывода через 24 часа после продажи. В будущем срок будет сокращён до 5 часов.';

function sellerRegisteredAt(core: Core): string | null {
  return core.profile?.registeredAt
    ?? core.profile?.trustCard?.registeredAt
    ?? null;
}

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="lot-form__section">
      <h3 className="lot-form__section-title">
        <span className="lot-form__section-num" aria-hidden="true">{n}</span>
        {title}
      </h3>
      <div className="lot-form__section-body">{children}</div>
    </section>
  );
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
  const [descAlign, setDescAlign] = useState<DescAlign>('left');
  const [descFont, setDescFont] = useState<DescFont>('body');
  const [advancedOpen, setAdvancedOpen] = useState(false);

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

  return (
    <div className="stack narrow lot-form">
      <Card className="lot-form__card">
        <header className="lot-form__head">
          <h2>Создание товара</h2>
        </header>
        <form className="form lot-form__form" onSubmit={submit}>
          {errors.length > 0 && (
            <div className="form-error" role="alert">
              <strong>Проверьте данные:</strong>
              {errors.map((item) => <span key={item}>— {item}</span>)}
            </div>
          )}
          {core.errors['product-form'] && (
            <div className="form-error" role="alert"><strong>{core.errors['product-form']}</strong></div>
          )}

          <Section n={1} title="Основная информация">
            <Field label="Название товара" hint={`${draft.title.length}/32`}>
              <Input
                required
                minLength={5}
                maxLength={32}
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                placeholder="Например: Steam аккаунт с играми"
              />
            </Field>
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
            <Field label="Тип товара">
              <div className="lot-form__types game-page__subs" role="list" aria-label="Подкатегории">
                {subs.map((item) => (
                  <button
                    type="button"
                    role="listitem"
                    className={`game-page__sub${draft.subcategory === item ? ' is-active' : ''}`}
                    key={item}
                    onClick={() => setDraft({ ...draft, subcategory: item })}
                  >
                    <span className="game-page__sub-label">{SUBCATEGORY_LABELS[item] ?? item}</span>
                  </button>
                ))}
              </div>
            </Field>
          </Section>

          <Section n={2} title="Описание">
            <DescriptionEditor
              value={draft.description}
              onChange={(description) => setDraft({ ...draft, description })}
              align={descAlign}
              font={descFont}
              onAlignChange={setDescAlign}
              onFontChange={setDescFont}
              placeholder="Подробно опишите товар: что получит покупатель, условия передачи, нюансы."
            />
          </Section>

          <Section n={3} title="Цена и количество">
            <div className="form-grid">
              <Field label="Цена, ₽" hint={`От ${minRub} ₽ · комиссия 5% (= ${payout ? `${payout} ₽` : '0,00 ₽'})`}>
                <Input
                  required
                  inputMode="decimal"
                  value={draft.priceRubles}
                  onChange={(event) => setDraft({ ...draft, priceRubles: event.target.value })}
                />
              </Field>
              <Field label="Количество">
                <Input
                  required
                  type="number"
                  min={1}
                  max={999}
                  value={draft.quantity}
                  onChange={(event) => setDraft({ ...draft, quantity: Number(event.target.value) })}
                />
              </Field>
            </div>
          </Section>

          <button
            type="button"
            className={`lot-form__advanced${advancedOpen ? ' is-open' : ''}`}
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            <span>
              <strong>Дополнительные настройки</strong>
              <small>Автоматическая выдача, заморозка средств, гарантии</small>
            </span>
            <em aria-hidden="true">{advancedOpen ? '▴' : '▾'}</em>
          </button>
          {advancedOpen && (
            <div className="lot-form__advanced-body">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={Boolean(draft.autoDeliver)}
                  onChange={(event) => setDraft({ ...draft, autoDeliver: event.target.checked })}
                />
                Автоматическая выдача
              </label>
                  {draft.autoDeliver && (
                <Field label="Текст товара" hint="login / password / код / ссылка — выдаётся только после оплаты">
                  <textarea
                    className="control control--area"
                    required
                    maxLength={4000}
                    value={draft.deliveryText || ''}
                    onChange={(event) => setDraft({ ...draft, deliveryText: event.target.value })}
                  />
                </Field>
              )}
              <Field
                label="Заморозка денег продавца"
                hint={showNewSellerNote
                  ? NEW_SELLER_HOLD_HINT
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
            </div>
          )}

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
          <div className="summary-line">
            <span>К получению (после 5%)</span>
            <strong>{payout ? `${payout} ₽` : '—'}</strong>
          </div>
          <Button
            type="submit"
            variant="violet"
            className="lot-form__publish"
            busy={core.actionBusy === 'product-form'}
            disabled={core.profile?.hasTelegram === false}
          >
            Опубликовать товар
          </Button>
        </form>
      </Card>
    </div>
  );
}
export default ProductForm;
