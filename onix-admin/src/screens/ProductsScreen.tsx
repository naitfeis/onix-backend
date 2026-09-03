import { useEffect, useState } from 'react';
import { adminApi, AdminApiError } from '../api/client';
import { ruProductStatus, ruRiskType } from '../i18n';
import { RiskEvidence } from './RiskEvidence';

type Product = {
  id: string;
  lotNumber: number;
  title: string;
  status: string;
  priceCents: string;
  quantity: number;
  createdAt: string;
  seller: { onixId: string; displayName?: string | null };
};

type ProductDetail = Product & {
  description?: string | null;
  category?: string;
  subcategory?: string | null;
  warrantyHours?: number;
  autoDeliver?: boolean;
  seller: {
    onixId: string;
    displayName?: string | null;
    telegramId?: string | null;
    id?: string;
    completedSales?: number;
    registeredAt?: string;
    riskScore?: number;
    risk?: Array<{
      id: string;
      type: string;
      severity: number;
      createdAt: string;
      payload: Record<string, unknown>;
    }>;
  };
};

function money(cents: string) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return cents;
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(n / 100);
}

export function ProductsScreen({
  initialId,
  onOpenSeller,
}: {
  initialId?: string | null;
  onOpenSeller?: (onixId: string) => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProductDetail | null>(null);

  async function load() {
    setError(null);
    try {
      const result = await adminApi<{ products: Product[] }>(`/api/admin/products?limit=200${status ? `&status=${status}` : ''}`);
      setProducts(result.products);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : 'Не удалось загрузить лоты');
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (initialId) void openLot(initialId);
  }, [initialId]);

  async function openLot(id: string) {
    setError(null);
    try {
      setDetail(await adminApi<ProductDetail>(`/api/admin/products/${encodeURIComponent(id)}`));
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : 'Не удалось открыть лот');
    }
  }

  async function reject(id: string, withReason: boolean) {
    const why = reason.trim();
    if (withReason && why.length < 4) {
      setError('Укажите причину отклонения (минимум 4 символа) или снимите лот без причины.');
      return;
    }
    try {
      await adminApi(`/api/admin/products/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason: withReason ? why : undefined }),
      });
      setDetail(null);
      await load();
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : 'Не удалось отклонить лот');
    }
  }

  return (
    <div className="panel">
      <h2>Модерация лотов</h2>
      <div className="row">
        <label>Статус
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Все</option>
            <option value="ACTIVE">Активен</option>
            <option value="ARCHIVED">Снят</option>
            <option value="RESERVED">В сделке</option>
            <option value="SOLD_OUT">Нет в наличии</option>
          </select>
        </label>
        <label>Причина отклонения
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="можно оставить пустым" />
        </label>
        <button className="primary" type="button" onClick={() => void load()}>Обновить</button>
      </div>
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Лот</th>
            <th>Название</th>
            <th>Продавец</th>
            <th>Статус</th>
            <th>Цена / кол-во</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id} className="click-row" onClick={() => void openLot(product.id)}>
              <td>
                <button className="link-button" type="button" onClick={(ev) => { ev.stopPropagation(); void openLot(product.id); }}>
                  ONIXLOT-{product.lotNumber}
                </button>
              </td>
              <td>{product.title}</td>
              <td>
                {onOpenSeller ? (
                  <button className="link-button" type="button" onClick={(ev) => { ev.stopPropagation(); onOpenSeller(product.seller.onixId); }}>
                    {product.seller.onixId}
                  </button>
                ) : product.seller.onixId}
              </td>
              <td>{ruProductStatus(product.status)}</td>
              <td>{money(product.priceCents)} / {product.quantity}</td>
              <td onClick={(ev) => ev.stopPropagation()}>
                {product.status !== 'ARCHIVED' && (
                  <>
                    <button className="ghost" type="button" onClick={() => void reject(product.id, false)}>Снять</button>
                    {' '}
                    <button className="danger" type="button" onClick={() => void reject(product.id, true)}>Отклонить с причиной</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {detail && (
        <div className="detail">
          <h3>ONIXLOT-{detail.lotNumber}</h3>
          <p><strong>{detail.title}</strong> · {ruProductStatus(detail.status)} · {money(detail.priceCents)}</p>
          {detail.description ? <p>{detail.description}</p> : <p className="muted">Описания нет.</p>}
          {detail.warrantyHours != null && <p className="muted">Гарантия: {detail.warrantyHours} ч</p>}
          {detail.autoDeliver ? <p className="muted">Автовыдача включена</p> : null}
          {detail.category ? <p className="muted">Категория: {detail.category}{detail.subcategory ? ` · ${detail.subcategory}` : ''}</p> : null}
          <h3>Продавец</h3>
          <p>
            {onOpenSeller ? (
              <button className="link-button" type="button" onClick={() => onOpenSeller(detail.seller.onixId)}>{detail.seller.onixId}</button>
            ) : detail.seller.onixId}
            {detail.seller.displayName ? ` · ${detail.seller.displayName}` : ''}
            {detail.seller.telegramId ? ` · Telegram ${detail.seller.telegramId}` : ''}
            {detail.seller.completedSales != null ? ` · продаж: ${detail.seller.completedSales}` : ''}
          </p>
          {detail.seller.registeredAt && (
            <p className="muted">Зарегистрирован {new Date(detail.seller.registeredAt).toLocaleString('ru-RU')}</p>
          )}
          <h3>Риск-движок · набрано {detail.seller.riskScore ?? 0}</h3>
          {(detail.seller.risk ?? []).length === 0 ? (
            <p className="muted">Сигналов риска нет.</p>
          ) : (detail.seller.risk ?? []).map((event) => (
            <div key={event.id} className="flag">
              <strong>{ruRiskType(event.type)}</strong> · оценка {event.severity} · {new Date(event.createdAt).toLocaleString('ru-RU')}
              <RiskEvidence payload={event.payload} onOpenUser={onOpenSeller} />
            </div>
          ))}
          <div className="row">
            <button className="ghost" type="button" onClick={() => setDetail(null)}>Закрыть</button>
            {onOpenSeller && (
              <button className="primary" type="button" onClick={() => onOpenSeller(detail.seller.onixId)}>Карточка продавца</button>
            )}
            {detail.status !== 'ARCHIVED' && (
              <>
                <button className="ghost" type="button" onClick={() => void reject(detail.id, false)}>Снять без причины</button>
                <button className="danger" type="button" onClick={() => void reject(detail.id, true)}>Отклонить с причиной</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
