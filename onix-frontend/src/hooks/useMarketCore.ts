import { useState, useCallback, useEffect } from 'react';
import WebApp from '@twa-dev/sdk';

export interface IProduct {
  id: string;
  title: string;
  description: string | null;
  priceCents: string;
  category: string;
  sellerNick: string;
  sellerId: string;
  status: 'ACTIVE' | 'RESERVED' | 'SOLD_OUT';
  createdAt: string;
}

export interface IOrder {
  id: string;
  productId: string;
  productTitle: string;
  category: string;
  totalAmountCents: string;
  status: 'PAYMENT_HOLD' | 'DELIVERING' | 'COMPLETED' | 'CANCELED' | 'DISPUTE';
  role: 'buyer' | 'seller';
  counterpartyNick: string;
  createdAt: string;
}

const API = '/api';

const getInitData = () => {
  try { return WebApp.initData || ''; } catch { return ''; }
};

const apiFetch = (url: string, options?: RequestInit) =>
  fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-init-data': getInitData(),
      ...(options?.headers ?? {}),
    },
  });

export function useMarketCore(tgId: string) {
  const [products, setProducts]           = useState<IProduct[]>([]);
  const [orders, setOrders]               = useState<IOrder[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<IProduct | null>(null);
  const [loading, setLoading]             = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<string>('');

  // ── Витрина ──────────────────────────────────────────────────────────────
  const refreshMarket = useCallback(async (category?: string) => {
    try {
      const url = category
        ? `${API}/products?category=${encodeURIComponent(category)}`
        : `${API}/products`;
      const res = await apiFetch(url);
      const result = await res.json();
      if (res.ok && result.success) setProducts(result.data);
    } catch {
      console.error('[MARKET] Ошибка загрузки витрины');
    } finally {
      setLoading(false);
    }
  }, []);

  // ── История сделок ────────────────────────────────────────────────────────
  const refreshOrders = useCallback(async () => {
    if (!tgId) return;
    try {
      const res = await apiFetch(`${API}/users/orders?tgId=${tgId}`);
      const result = await res.json();
      if (res.ok && result.success) {
        setOrders([...result.data.purchases, ...result.data.sales]);
      }
    } catch {
      console.error('[ORDERS] Ошибка загрузки сделок');
    }
  }, [tgId]);

  useEffect(() => {
    refreshMarket();
    refreshOrders();
  }, [refreshMarket, refreshOrders]);

  // ── Создание лота ─────────────────────────────────────────────────────────
  const createProduct = useCallback(async (
    title: string,
    description: string,
    price: string,
    category: string,
  ): Promise<boolean> => {
    const parsedPrice = parseFloat(price);
    if (parsedPrice < 10 || parsedPrice > 50000) {
      try { WebApp.HapticFeedback.notificationOccurred('error'); } catch {}
      alert('Цена лота должна быть от 10 до 50 000 ₽');
      return false;
    }
    try {
      const res = await apiFetch(`${API}/products/create`, {
        method: 'POST',
        body: JSON.stringify({ title, description, price: parsedPrice, quantity: 1, category, sellerId: tgId }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.message ?? 'Ошибка сервера');
      try { WebApp.HapticFeedback.notificationOccurred('success'); } catch {}
      refreshMarket(categoryFilter);
      return true;
    } catch (err: unknown) {
      try { WebApp.HapticFeedback.notificationOccurred('error'); } catch {}
      alert(`Ошибка публикации: ${(err as Error).message}`);
      return false;
    }
  }, [tgId, categoryFilter, refreshMarket]);

  // ── Покупка (Фаза 1) ──────────────────────────────────────────────────────
  const buyProduct = useCallback(async (product: IProduct): Promise<boolean> => {
    try {
      const res = await apiFetch(`${API}/products/purchase`, {
        method: 'POST',
        body: JSON.stringify({ buyerId: tgId, productId: product.id }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.message ?? 'Ошибка кассы');
      try { WebApp.HapticFeedback.notificationOccurred('success'); } catch {}
      setSelectedProduct(null);
      refreshMarket(categoryFilter);
      refreshOrders();
      window.dispatchEvent(new CustomEvent('onix.switch_tab', { detail: { tab: 'deals' } }));
      return true;
    } catch (err: unknown) {
      try { WebApp.HapticFeedback.notificationOccurred('error'); } catch {}
      alert(`Ошибка покупки: ${(err as Error).message}`);
      return false;
    }
  }, [tgId, categoryFilter, refreshMarket, refreshOrders]);

  // ── Подтверждение отгрузки (Фаза 2) ──────────────────────────────────────
  const confirmDelivery = useCallback(async (orderId: string): Promise<boolean> => {
    try {
      const res = await apiFetch(`${API}/products/confirm-delivery`, {
        method: 'POST',
        body: JSON.stringify({ sellerId: tgId, orderId }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.message ?? 'Ошибка');
      try { WebApp.HapticFeedback.impactOccurred('medium'); } catch {}
      refreshOrders();
      return true;
    } catch (err: unknown) {
      alert(`Ошибка: ${(err as Error).message}`);
      return false;
    }
  }, [tgId, refreshOrders]);

  // ── Подтверждение получения (Фаза 3) ─────────────────────────────────────
  const completeOrder = useCallback(async (orderId: string): Promise<boolean> => {
    try {
      const res = await apiFetch(`${API}/products/complete`, {
        method: 'POST',
        body: JSON.stringify({ buyerId: tgId, orderId }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.message ?? 'Ошибка');
      try { WebApp.HapticFeedback.notificationOccurred('success'); } catch {}
      refreshOrders();
      return true;
    } catch (err: unknown) {
      try { WebApp.HapticFeedback.notificationOccurred('error'); } catch {}
      alert(`Ошибка завершения: ${(err as Error).message}`);
      return false;
    }
  }, [tgId, refreshOrders]);

  return {
    products, orders, selectedProduct, setSelectedProduct,
    loading, categoryFilter, setCategoryFilter,
    refreshMarket, refreshOrders,
    createProduct, buyProduct, confirmDelivery, completeOrder,
  };
}