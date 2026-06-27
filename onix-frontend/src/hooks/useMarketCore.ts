import { useState, useCallback, useEffect } from 'react';
import WebApp from '@twa-dev/sdk';

export interface IProduct {
  id: string;
  title: string;
  description: string;
  priceCents: string;
  category: string;
  sellerId: string;
  sellerNick: string;
  status: 'ACTIVE' | 'RESERVED' | 'SOLD_OUT';
}

export interface IOrder {
  id: string;
  productId: string;
  productTitle: string;
  priceCents: string;
  buyerId: string;
  sellerId: string;
  sellerNick: string;
  status: 'PAYMENT_HOLD' | 'DELIVERING' | 'COMPLETED' | 'CANCELED' | 'DISPUTE';
}

export function useMarketCore() {
  const [liveBalanceRubles, setLiveBalanceRubles] = useState<number>(5000);
  const [currentUserId] = useState<string>("7099007790");
  const [currentUserNick] = useState<string>("shop_rub");

  const [products, setProducts] = useState<IProduct[]>([
    { id: "cuid_1", title: "M9 Bayonet Scratch", description: "Передача через рынок. Слейте любой треш-скин за эту сумму.", priceCents: "120000", category: "STANDOFF 2", sellerId: "999999", sellerNick: "Trapper_22", status: "ACTIVE" },
    { id: "cuid_2", title: "Karambit Gold", description: "Выставлю по вашему запросу. Передача за 5 минут.", priceCents: "250000", category: "STANDOFF 2", sellerId: "888888", sellerNick: "Standoff_King", status: "ACTIVE" }
  ]);
  const [orders, setOrders] = useState<IOrder[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<IProduct | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 500);
    return () => clearTimeout(timer);
  }, []);

  // ФАЗА ВЫСТАВЛЕНИЯ С АНТИ-ФРОД ФИЛЬТРОМ ЦЕН
  const createProductLog = useCallback((title: string, description: string, price: string, category: string) => {
    const parsedPrice = parseFloat(price);

    if (parsedPrice < 10 || parsedPrice > 50000) {
      WebApp.HapticFeedback.notificationOccurred('error');
      alert("🚨 Отказ ONIX Shield: Цена лота должна быть в диапазоне от 10 до 50 000 ₽");
      return;
    }

    const priceCentsStr = Math.round(parsedPrice * 100).toString();
    const newProduct: IProduct = {
      id: `cuid_${Date.now()}`,
      title,
      description,
      priceCents: priceCentsStr,
      category,
      sellerId: currentUserId,
      sellerNick: currentUserNick,
      status: 'ACTIVE'
    };

    setProducts(prev => [newProduct, ...prev]);
    WebApp.HapticFeedback.notificationOccurred('success');
  }, [currentUserId, currentUserNick]);

  // ФАНПЕЙ ФАЗА 1: Покупка товара покупателем
  const handleBuyProduct = useCallback((product: IProduct) => {
    const priceRub = parseInt(product.priceCents, 10) / 100;

    if (liveBalanceRubles < priceRub) {
      WebApp.HapticFeedback.notificationOccurred('error');
      alert("❌ Ошибка Гаранта: Недостаточно средств на балансе!");
      return;
    }

    setLiveBalanceRubles(prev => prev - priceRub);
    setProducts(prev => prev.map(p => p.id === product.id ? { ...p, status: 'RESERVED' } : p));

    const newOrder: IOrder = {
      id: `order_${Date.now()}`,
      productId: product.id,
      productTitle: product.title,
      priceCents: product.priceCents,
      buyerId: currentUserId,
      sellerId: product.sellerId,
      sellerNick: product.sellerNick,
      status: 'PAYMENT_HOLD'
    };

    setOrders(prev => [newOrder, ...prev]);
    setSelectedProduct(null);
    WebApp.HapticFeedback.notificationOccurred('success');
    alert(`🔒 ГОЛД-ХОЛД ЗАПУЩЕН\nОрдер заблокирован в сейфе ONIX. Продавец уведомлен.`);
  }, [liveBalanceRubles, currentUserId]);

  // ФАНПЕЙ ФАЗА 2: Продавец подтверждает отгрузку ножа в игре
  const handleSellerSent = useCallback((orderId: string) => {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'DELIVERING' } : o));
    WebApp.HapticFeedback.impactOccurred('medium');
    alert(`⚡ Продавец подтвердил отгрузку лота! Покупатель, проверьте инвентарь.`);
  }, []);

    // 🏆 ФАНПЕЙ ФАЗА 3: Ручное мгновенное подтверждение покупателем + 5% маржа + 50 ₽ за фиатный вывод
  const handleConfirmReceive = useCallback((order: IOrder) => {
    setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: 'COMPLETED' } : o));
    setProducts(prev => prev.filter(p => p.id !== order.productId));

    const priceRub = parseInt(order.priceCents, 10) / 100;

    // 🔥 СИНЬОР-РАСЧЁТ МАРЖИ: Скрытые 5% системы Гаранта [PDF: 0.1.7]
    const systemFee = priceRub * 0.05;

    // 💳 ФИКСИРОВАННАЯ ВЫПЛАТА: Из чистой суммы продавца вычитается 50 рублей за транзакцию банка/СБП
    const fixWithdrawalFee = 50;
    const finalPayoutAmount = priceRub - systemFee - fixWithdrawalFee;

    WebApp.HapticFeedback.notificationOccurred('success');

    if (finalPayoutAmount <= 0) {
      alert(
        `🚨 ВНИМАНИЕ: Лот закрыт успешно, но сумма продажи меньше банковской комиссии в 50 рублей!\n` +
        `Чистая маржа Максима (5%): +${systemFee.toFixed(2)} ₽\n` +
        `Деньги продавца ушли на покрытие эквайринга.`
      );
    } else {
      alert(
        `🏆 СДЕЛКА УСПЕШНО ЗАВЕРШЕНА!\n` +
        `───────────────────\n` +
        `Скрытая маржа Максима (5%): +${systemFee.toFixed(2)} ₽\n` +
        `Фиксированная комиссия СБП: 50.00 ₽\n` +
        `Чистая мгновенная выплата продавцу на карту: ${finalPayoutAmount.toFixed(2)} ₽`
      );
    }
  }, []);

  // ОТКРЫТИЕ АРБИТРАЖА (ЗАМОРОЗКА ОРДЕРА)
  const handleOpenDispute = useCallback((orderId: string) => {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'DISPUTE' } : o));
    WebApp.HapticFeedback.notificationOccurred('warning');
    alert("🚨 СДЕЛКА ЗАМОРОЖЕНА АРБИТРАЖЕМ!\nОрдер передан на ручную проверку Максиму (CEO ONIX).");
  }, []);

  return {
    liveBalanceRubles, currentUserNick, products, orders, selectedProduct, setSelectedProduct, loading,
    createProductLog, handleBuyProduct, handleSellerSent, handleConfirmReceive, handleOpenDispute
  };
}