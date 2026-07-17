import { useState, type FormEvent } from 'react';
import { CATEGORIES, CATEGORY_LABELS, SUBCATEGORIES_BY_CATEGORY, SUBCATEGORY_LABELS, type ProductDraft } from '../api/contracts';
import { Button, Card, Field, Input, Select, Textarea } from '../design-system';
import { validateDraft } from '../utils/productValidation';
import type { Core } from './types';
import { emptyDraft } from './shared';

export function ProductForm({ core, onDone, setToast }: { core: Core; onDone: () => void; setToast: (text: string) => void }) {
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft);
  const [errors, setErrors] = useState<string[]>([]);
  const subs = SUBCATEGORIES_BY_CATEGORY[draft.category as typeof CATEGORIES[number]] ?? SUBCATEGORIES_BY_CATEGORY.OTHER;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = validateDraft(draft);
    setErrors(next);
    if (next.length) return;
    if (await core.createProduct(draft)) { setToast('Лот опубликован на витрине.'); setDraft(emptyDraft); onDone(); }
  };
  return <div className="stack narrow">
    <Card><form className="form" onSubmit={submit}>
      {errors.length > 0 && <div className="form-error" role="alert"><strong>Проверьте данные:</strong>{errors.map(item => <span key={item}>— {item}</span>)}</div>}
      {core.errors['product-form'] && <div className="form-error" role="alert"><strong>{core.errors['product-form']}</strong></div>}
      <Field label="Название"><Input required minLength={5} maxLength={80} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder="Например, Butterfly | Fade" /></Field>
      <Field label="Описание" hint="Не публикуйте пароли в описании — используйте автовыдачу"><Textarea required maxLength={1500} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></Field>
      <Field label="Категория"><Select value={draft.category} onChange={event => {
        const category = event.target.value;
        const nextSubs = SUBCATEGORIES_BY_CATEGORY[category as typeof CATEGORIES[number]] ?? SUBCATEGORIES_BY_CATEGORY.OTHER;
        setDraft({ ...draft, category, subcategory: nextSubs[0] });
      }}>{CATEGORIES.map(item => <option key={item} value={item}>{CATEGORY_LABELS[item]}</option>)}</Select></Field>
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
      <div className="form-grid"><Field label="Цена, ₽"><Input required inputMode="decimal" value={draft.priceRubles} onChange={event => setDraft({ ...draft, priceRubles: event.target.value })} /></Field>
        <Field label="Количество"><Input required type="number" min={1} max={999} value={draft.quantity} onChange={event => setDraft({ ...draft, quantity: Number(event.target.value) })} /></Field></div>
      <label className="check-row"><input type="checkbox" checked={Boolean(draft.autoDeliver)} onChange={event => setDraft({ ...draft, autoDeliver: event.target.checked })} /> Автоматическая выдача</label>
      {draft.autoDeliver && <Field label="Текст товара" hint="login / password / код / ссылка — выдаётся только после оплаты"><Textarea required maxLength={4000} value={draft.deliveryText || ''} onChange={event => setDraft({ ...draft, deliveryText: event.target.value })} /></Field>}
      <div className="summary-line"><span>К получению</span><strong>{draft.priceRubles && Number.isFinite(Number(draft.priceRubles)) ? `${Number(draft.priceRubles).toFixed(2)} ₽` : '—'}</strong></div>
      <Button type="submit" busy={core.actionBusy === 'product-form'}>ОПУБЛИКОВАТЬ ЛОТ</Button>
    </form></Card></div>;
}
export default ProductForm;
