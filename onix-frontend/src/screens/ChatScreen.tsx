import { useState, useMemo } from 'react';
import { useMarketCore } from '../hooks/useMarketCore';
import type { IOrder } from '../hooks/useMarketCore';
import WebApp from '@twa-dev/sdk';

export default function DealScreen() {
  // 🛰️ Подключаем наш главный финтех-"мозг" из папки hooks
  const {
    orders,
    handleSellerSent,
    handleConfirmReceive,
    handleOpenDispute
  } = useMarketCore();

  // Локальный стейт переключения табов: PURCHASES (Покупки) / SALES (Продажи)
  const [activeTab, setActiveTab] = useState<'PURCHASES' | 'SALES'>('PURCHASES');

  // Твой зафиксированный ID в системе для сверки ролей контрактов
  const currentUserId = "7099007790";

  // 📊 Динамическая фильтрация ордеров по ролям юзера в режиме реального времени
  const filteredOrders = useMemo(() => {
    return orders.filter(order => {
      if (activeTab === 'PURCHASES') {
        return order.buyerId === currentUserId; // Я купил лот
      } else {
        return order.sellerId === currentUserId; // Я продаю лот
      }
    });
  }, [orders, activeTab]);

  // Триггер запуска легкой тактильной вибрации при смене вкладок
  const switchTab = (tab: 'PURCHASES' | 'SALES') => {
    WebApp.HapticFeedback.impactOccurred('light');
    setActiveTab(tab);
  };

  // Обертка для безопасного открытия спора с вызовом вибро-пуша
  const triggerDispute = (orderId: string) => {
    WebApp.HapticFeedback.notificationOccurred('warning');
    handleOpenDispute(orderId);
  };

  return (
    <div style={{ background: '#000', color: '#fff', minHeight: '100vh', padding: '16px', fontFamily: 'monospace', display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* Шапка монитора контрактов */}
      <div style={{ background: '#0b0b0b', border: '1px solid #161616', padding: '14px', borderRadius: '4px' }}>
        <div style={{ fontSize: '11px', color: '#fff', fontWeight: 'bold' }}>// 🔒 ESCROW TELEMETRY PORTAL (ГАРАНТ)</div>
        <div style={{ fontSize: '9px', color: '#555', letterSpacing: '0.5px', marginTop: '2px' }}>КОНТРОЛЬ ЗАМОРОЖЕННЫХ СЕЙФОВ СДЕЛКА В СДЕЛКУ</div>
      </div>

      {/* 🚦 СИНЬОР-ТАБЫ: Двухканальное распределение потоков сделок */}
      <div style={{ display: 'flex', background: '#030303', border: '1px solid #1c1c1c', padding: '4px', borderRadius: '4px', gap: '4px' }}>
        <button
          onClick={() => switchTab('PURCHASES')}
          style={{ flex: 1, padding: '12px', background: activeTab === 'PURCHASES' ? '#141519' : 'transparent', color: activeTab === 'PURCHASES' ? '#00d2d3' : '#555', border: 'none', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer', borderRadius: '4px', transition: 'all 0.2s' }}
        >
          🛒 МОИ ПОКУПКИ ({orders.filter(o => o.buyerId === currentUserId).length})
        </button>
        <button
          onClick={() => switchTab('SALES')}
          style={{ flex: 1, padding: '12px', background: activeTab === 'SALES' ? '#141519' : 'transparent', color: activeTab === 'SALES' ? '#1dd1a1' : '#555', border: 'none', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer', borderRadius: '4px', transition: 'all 0.2s' }}
        >
          💰 МОИ ПРОДАЖИ ({orders.filter(o => o.sellerId === currentUserId).length})
        </button>
      </div>

      {/* Список отфильтрованных сейфов */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {filteredOrders.length === 0 ? (
          <div style={{ color: '#333', fontSize: '11px', textAlign: 'center', padding: '40px', border: '1px dashed #1a1a1a', borderRadius: '4px' }}>
            {activeTab === 'PURCHASES'
              ? 'Контур пуст. Вы еще не оплачивали лоты в Гарант.'
              : 'В стакане пусто. Ваша голда или ножи еще не куплены пацанами.'}
          </div>
        ) : (
          filteredOrders.map((order: IOrder) => {
            const priceRub = parseInt(order.priceCents, 10) / 100;

            return (
              <div
                key={order.id}
                style={{
                  background: '#050508',
                  border: '1px solid #1c1c1c',
                  padding: '16px',
                  borderRadius: '4px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}
              >
                {/* Заголовок лота и цена */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 'bold', color: '#fff', fontSize: '13px' }}>{order.productTitle}</span>
                  <span style={{ color: '#00d2d3', fontWeight: 'bold', fontSize: '14px' }}>{priceRub.toFixed(2)} ₽</span>
                </div>

                {/* Информационный шилд контрагента */}
                <div style={{ fontSize: '10px', color: '#444' }}>
                  {activeTab === 'PURCHASES'
                    ? `ПРОДАВЕЦ ЛОТА: @${order.sellerNick}`
                    : `ПОКУПАТЕЛЬ ЛОТА: ID #${order.buyerId}`}
                </div>

                {/* Брутальный Неоновый Статус-бар фаз по нашему ТЗ */}
                <div style={{ background: '#000', border: '1px solid #111', padding: '10px', borderRadius: '4px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ fontSize: '10px', color: '#666', display: 'flex', justifyContent: 'space-between' }}>
                    <span>ФАЗА СДЕЛКИ:</span>
                    <strong style={{
                      color: order.status === 'COMPLETED' ? '#1dd1a1' :
                             order.status === 'DISPUTE' ? '#ff4757' : '#ff9f43'
                    }}>
                      {order.status === 'PAYMENT_HOLD' && 'ДЕНЬГИ В СЕЙФЕ 🔒'}
                      {order.status === 'DELIVERING' && 'ВСПЛЫВАЮЩАЯ ДОСТАВКА 📦'}
                      {order.status === 'COMPLETED' && 'КОНТРАКТ ЗАКРЫТ ✅'}
                      {order.status === 'DISPUTE' && 'АРБИТРАЖ CEO ОНИКС ⚖️'}
                    </strong>
                  </div>
                </div>

                {/* 🛠️ ФИНАНСОВЫЙ ИНТЕРФЕЙС УПРАВЛЕНИЯ КНОПКАМИ */}
                <div style={{ display: 'flex', gap: '8px' }}>

                  {/* Контур Продавца: подтверждение отгрузки */}
                  {activeTab === 'SALES' && order.status === 'PAYMENT_HOLD' && (
                    <button
                      onClick={() => handleSellerSent(order.id)}
                      style={{ flex: 1, background: '#ff9f43', color: '#000', border: 'none', padding: '12px', fontSize: '11px', fontWeight: 'bold', borderRadius: '4px', cursor: 'pointer', letterSpacing: '0.5px' }}
                    >
                      📦 Я ОТПРАВИЛ СКИН В STANDOFF 2
                    </button>
                  )}

                  {/* Контур Покупателя: Кнопки финализации или Спора */}
                  {activeTab === 'PURCHASES' && order.status === 'DELIVERING' && (
                    <>
                      <button
                        onClick={() => handleConfirmReceive(order)}
                        style={{ flex: 2, background: '#1dd1a1', color: '#000', border: 'none', padding: '12px', fontSize: '11px', fontWeight: 'bold', borderRadius: '4px', cursor: 'pointer', letterSpacing: '0.5px' }}
                      >
                        ✅ НОЖ У МЕНЯ (МГНОВЕННЫЙ КЛИРИНГ)
                      </button>
                      <button
                        onClick={() => triggerDispute(order.id)}
                        style={{ flex: 1, background: '#ff4757', color: '#fff', border: 'none', padding: '12px', fontSize: '11px', fontWeight: 'bold', borderRadius: '4px', cursor: 'pointer' }}
                      >
                        🚨 СПОР
                      </button>
                    </>
                  )}

                  {/* Заглушка ожидания для Продавца в фазе доставки */}
                  {activeTab === 'SALES' && order.status === 'DELIVERING' && (
                    <div style={{ color: '#ff9f43', fontSize: '10px', textAlign: 'center', width: '100%', background: 'rgba(255,159,67,0.02)', padding: '8px', border: '1px dashed #ff9f43', borderRadius: '4px' }}>
                      ⌛ Ожидайте ручного подтверждения от покупателя...
                    </div>
                  )}

                  {/* Заглушка ожидания для Покупателя в фазе холда */}
                  {activeTab === 'PURCHASES' && order.status === 'PAYMENT_HOLD' && (
                    <div style={{ color: '#ff9f43', fontSize: '10px', textAlign: 'center', width: '100%', background: 'rgba(255,159,67,0.02)', padding: '8px', border: '1px dashed #ff9f43', borderRadius: '4px' }}>
                      🔒 Деньги заморожены в Гаранте. Продавец выкатывает лот...
                    </div>
                  )}

                  {/* Системный лог Спора (Виден обеим сторонам) */}
                  {order.status === 'DISPUTE' && (
                    <div style={{ color: '#ff4757', fontSize: '10px', fontWeight: 'bold', textAlign: 'center', width: '100%', background: 'rgba(255,71,87,0.04)', padding: '8px', border: '1px solid #ff4757', borderRadius: '4px' }}>
                      ⚖️ ТАЙМАУТ: КАССА ЗАБЛОКИРОВАНА. ДЕЛО РАЗБИРАЕТ МАКСИМ.
                    </div>
                  )}

                  {/* Финальный лог успешного закрытия ордера */}
                  {order.status === 'COMPLETED' && (
                    <div style={{ color: '#1dd1a1', fontSize: '10px', fontWeight: 'bold', textAlign: 'center', width: '100%', background: 'rgba(29,209,161,0.04)', padding: '8px', border: '1px solid #1dd1a1', borderRadius: '4px' }}>
                      🏆 СДЕЛКА ЗАКРЫТА. 5% МАРЖИ ONIX И 50₽ УСПЕШНО ОПТИМИЗИРОВАНЫ.
                    </div>
                  )}

                </div>
              </div>
            );
          })
        )}
      </div>

    </div>
  );
}