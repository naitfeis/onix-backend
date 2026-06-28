import { useState } from 'react';
import { useMarketCore } from '../hooks/useMarketCore';
import type { IOrder } from '../hooks/useMarketCore';
import WebApp from '@twa-dev/sdk';

interface Props { tgId: string }

const STATUS_LABEL: Record<string, string> = {
  PAYMENT_HOLD: '🔒 ДЕНЬГИ В СЕЙФЕ',
  DELIVERING:   '📦 ПРОДАВЕЦ ОТГРУЖАЕТ',
  COMPLETED:    '✅ КОНТРАКТ ЗАКРЫТ',
  CANCELED:     '❌ ОТМЕНЁН',
  DISPUTE:      '⚖️ АРБИТРАЖ',
};

const STATUS_COLOR: Record<string, string> = {
  PAYMENT_HOLD: '#ff9f43',
  DELIVERING:   '#00d2d3',
  COMPLETED:    '#1dd1a1',
  CANCELED:     '#ff4757',
  DISPUTE:      '#ff4757',
};

export default function DealScreen({ tgId }: Props) {
  const { orders, refreshOrders, confirmDelivery, completeOrder } = useMarketCore(tgId);
  const [activeTab, setActiveTab] = useState<'buyer' | 'seller'>('buyer');
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const filtered = orders.filter(o => o.role === activeTab);

  const handleConfirmDelivery = async (order: IOrder) => {
    if (loadingId) return;
    setLoadingId(order.id);
    await confirmDelivery(order.id);
    setLoadingId(null);
  };

  const handleCompleteOrder = async (order: IOrder) => {
    if (loadingId) return;
    const confirmed = window.confirm(
      `Подтвердите получение товара.\n\nПосле нажатия ОК деньги уйдут продавцу. Убедитесь что товар у вас в инвентаре!`
    );
    if (!confirmed) return;
    setLoadingId(order.id);
    const ok = await completeOrder(order.id);
    if (ok) {
      try { WebApp.HapticFeedback.notificationOccurred('success'); } catch {}
      alert('✅ Сделка завершена! Деньги зачислены продавцу.');
    }
    setLoadingId(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* Шапка */}
      <div style={{ background: '#0b0b0b', border: '1px solid #161616', padding: '12px', borderRadius: '4px' }}>
        <div style={{ fontSize: '11px', color: '#fff', fontWeight: 'bold' }}>// 🔒 ESCROW ГАРАНТ</div>
        <div style={{ fontSize: '9px', color: '#555', marginTop: '2px' }}>КОНТРОЛЬ ЗАМОРОЖЕННЫХ СДЕЛОК</div>
      </div>

      {/* Табы */}
      <div style={{ display: 'flex', gap: '4px', background: '#030303', border: '1px solid #1c1c1c', padding: '4px', borderRadius: '4px' }}>
        {(['buyer', 'seller'] as const).map((role) => {
          const label = role === 'buyer' ? '🛒 МОИ ПОКУПКИ' : '💰 МОИ ПРОДАЖИ';
          const count = orders.filter(o => o.role === role).length;
          const active = activeTab === role;
          return (
            <button
              key={role}
              onClick={() => { try { WebApp.HapticFeedback.impactOccurred('light'); } catch {} setActiveTab(role); }}
              style={{
                flex: 1, padding: '10px',
                background: active ? '#141519' : 'transparent',
                color: active ? (role === 'buyer' ? '#00d2d3' : '#1dd1a1') : '#555',
                border: 'none', borderRadius: '4px',
                fontSize: '11px', fontWeight: 'bold',
                cursor: 'pointer', fontFamily: 'monospace',
              }}
            >
              {label} ({count})
            </button>
          );
        })}
      </div>

      {/* Список сделок */}
      {filtered.length === 0 ? (
        <div style={{ color: '#333', fontSize: '11px', textAlign: 'center', padding: '40px', border: '1px dashed #1a1a1a', borderRadius: '4px' }}>
          {activeTab === 'buyer' ? 'Вы ещё ничего не покупали.' : 'Ваши лоты ещё не купили.'}
        </div>
      ) : (
        filtered.map((order) => {
          const priceRub = (parseInt(order.totalAmountCents) / 100).toFixed(2);
          const isLoading = loadingId === order.id;

          return (
            <div key={order.id} style={{ background: '#050508', border: '1px solid #1c1c1c', padding: '16px', borderRadius: '4px', display: 'flex', flexDirection: 'column', gap: '10px' }}>

              {/* Заголовок */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 'bold', color: '#fff', fontSize: '13px' }}>{order.productTitle}</span>
                <span style={{ color: '#00d2d3', fontWeight: 'bold' }}>{priceRub} ₽</span>
              </div>

              {/* Контрагент */}
              <div style={{ fontSize: '10px', color: '#444' }}>
                {activeTab === 'buyer' ? `ПРОДАВЕЦ: @${order.counterpartyNick}` : `ПОКУПАТЕЛЬ: @${order.counterpartyNick}`}
                {' // '}{order.category}
              </div>

              {/* Статус */}
              <div style={{
                background: '#000', border: '1px solid #111', padding: '8px', borderRadius: '4px',
                fontSize: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span style={{ color: '#555' }}>ФАЗА:</span>
                <strong style={{ color: STATUS_COLOR[order.status] ?? '#fff' }}>
                  {STATUS_LABEL[order.status] ?? order.status}
                </strong>
              </div>

              {/* Кнопки действий */}
              {activeTab === 'seller' && order.status === 'PAYMENT_HOLD' && (
                <button
                  onClick={() => handleConfirmDelivery(order)}
                  disabled={isLoading}
                  style={{ padding: '12px', background: isLoading ? '#1a1a1a' : '#ff9f43', color: '#000', border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold', cursor: isLoading ? 'not-allowed' : 'pointer', fontFamily: 'monospace' }}
                >
                  {isLoading ? 'ОТПРАВКА...' : '📦 Я ПЕРЕДАЛ ТОВАР ПОКУПАТЕЛЮ'}
                </button>
              )}

              {activeTab === 'buyer' && order.status === 'DELIVERING' && (
                <button
                  onClick={() => handleCompleteOrder(order)}
                  disabled={isLoading}
                  style={{ padding: '12px', background: isLoading ? '#1a1a1a' : '#1dd1a1', color: '#000', border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold', cursor: isLoading ? 'not-allowed' : 'pointer', fontFamily: 'monospace' }}
                >
                  {isLoading ? 'ОБРАБОТКА...' : '✅ ТОВАР ПОЛУЧЕН — ВЫДАТЬ ДЕНЬГИ'}
                </button>
              )}

              {activeTab === 'seller' && order.status === 'DELIVERING' && (
                <div style={{ color: '#ff9f43', fontSize: '10px', textAlign: 'center', padding: '8px', border: '1px dashed #ff9f43', borderRadius: '4px' }}>
                  ⌛ Ожидаем подтверждение от покупателя...
                </div>
              )}

              {activeTab === 'buyer' && order.status === 'PAYMENT_HOLD' && (
                <div style={{ color: '#ff9f43', fontSize: '10px', textAlign: 'center', padding: '8px', border: '1px dashed #ff9f43', borderRadius: '4px' }}>
                  🔒 Деньги заморожены. Продавец готовит товар...
                </div>
              )}

              {order.status === 'COMPLETED' && (
                <div style={{ color: '#1dd1a1', fontSize: '10px', textAlign: 'center', padding: '8px', border: '1px solid #1dd1a1', borderRadius: '4px' }}>
                  🏆 Сделка закрыта успешно.
                </div>
              )}

              {order.status === 'DISPUTE' && (
                <div style={{ color: '#ff4757', fontSize: '10px', fontWeight: 'bold', textAlign: 'center', padding: '8px', border: '1px solid #ff4757', borderRadius: '4px' }}>
                  ⚖️ Открыт арбитраж. Ожидайте решения администратора.
                </div>
              )}

            </div>
          );
        })
      )}

      {/* Кнопка обновить */}
      <button
        onClick={() => refreshOrders()}
        style={{ padding: '10px', background: 'transparent', color: '#444', border: '1px dashed #1c1c1c', borderRadius: '4px', fontSize: '10px', cursor: 'pointer', fontFamily: 'monospace' }}
      >
        🔄 ОБНОВИТЬ СПИСОК
      </button>
    </div>
  );
}