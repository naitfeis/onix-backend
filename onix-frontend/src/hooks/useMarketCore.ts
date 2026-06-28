import { useState, useCallback, useEffect } from 'react';
import WebApp from '@twa-dev/sdk';

export interface IProduct {
  id: string;
  title: string;
  description: string;
  priceCents: string;
  category: string;
  sellerId: string;
  status: 'ACTIVE' | 'RESERVED' | 'SOLD_OUT';
}

export function useMarketCore() {
  const [products, setProducts] = useState<IProduct[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedProduct, setSelectedProduct] = useState<IProduct | null>(null);

  const getTgId = (): string => {
    return WebApp.initDataUnsafe?.user?.id.toString() || "7099007790";
  };

  // 1. Асинхронный выкач товаров с базы для всех тестеров в реальном времени
  const refreshMarket = async () => {
    try {
      const response = await fetch('https://onrender.com', {
        headers: { 'x-telegram-init-data': WebApp.initData || '' }
      });
      const result = await response.json();
      if (response.ok) setProducts(result.data);
    } catch (e) {
      console.error('Сбой пула витрины');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshMarket();
  }, []);

  // 2. Аппаратная публикация нового лота на всю площадку
  const createProductLog = useCallback(async (title: string, description: string, price: string, category: string) => {
    const parsedPrice = parseFloat(price);
    try {
      const response = await fetch('https://onrender.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': WebApp.initData || '' },
        body: JSON.stringify({ title, description, price: parsedPrice, category, sellerId: getTgId() })
      });
      if (response.ok) {
        try { WebApp.HapticFeedback.notificationOccurred('success'); } catch {}
        refreshMarket();
      }
    } catch {
      alert('Ошибка базы данных при публикации контракта.');
    }
  }, []);

  // 3. Покупка лота с авто-переносом в чат
  const handleBuyProduct = useCallback(async (product: IProduct) => {
    try {
      const response = await fetch('https://onrender.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': WebApp.initData || '' },
        body: JSON.stringify({ buyerId: getTgId(), productId: product.id })
      });
      if (response.ok) {
        try { WebApp.HapticFeedback.notificationOccurred('success'); } catch {}
        setSelectedProduct(null);

        // Нативный автоперенос в чат маркетплейса
        window.dispatchEvent(new CustomEvent('onix.switch_tab', { detail: { tab: 'chat' } }));
      } else {
        const err = await response.json();
        alert(err.message || 'Ошибка клиринга кассы.');
      }
    } catch {
      alert('Шлюз СУБД недоступен.');
    }
  }, []);

  return {
    products, loading, selectedProduct, setSelectedProduct,
    createProductLog, handleBuyProduct, refreshMarket
  };
}