import React, { useState, useCallback } from 'react';
import WebApp from '@twa-dev/sdk'; // Нативно подключаем Telegram SDK для вибрации смартфона!

export const OrderStatus = {
  PENDING: 'PENDING',
  PAYMENT_HOLD: 'PAYMENT_HOLD',
  DELIVERING: 'DELIVERING',
  COMPLETED: 'COMPLETED',
  CANCELED: 'CANCELED'
} as const;

export type OrderStatusType = typeof OrderStatus[keyof typeof OrderStatus];

interface DealScreenProps {
  orderId: string;
  skinName: string;
  priceRubles: number;
  status: OrderStatusType;
  buyerId: string;
  sellerId: string;
}

export const DealScreen: React.FC<DealScreenProps> = ({
  orderId, skinName, priceRubles, status, buyerId, sellerId
}) => {
  const [isItemReceived, setIsItemReceived] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  // 🚀 Синьор-решение: Кэшируем функцию через useCallback, чтобы предотвратить лишний износ RAM смартфона
  const handleConfirmDeal = useCallback(async () => {
    if (loading) return; // АППАРАТНЫЙ БЛОКИРАТОР: Если запрос уже летит, второй клик полностью игнорируется!

    setLoading(true);
    setStatusMessage('Запуск финтех-транзакции ONIX...');

    // Вызываем легкую предупреждающую вибрацию на телефоне пацана перед списанием
    WebApp.HapticFeedback.notificationOccurred('warning');

    try {
      const response = await fetch('/api/garant/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, buyerId })
      });

      const data = await response.json();

      if (response.ok) {
        // Жесткий победный вибро-отклик (Транзакция закрыта успешно!)
        WebApp.HapticFeedback.notificationOccurred('success');
        setStatusMessage('🏆 Сделка успешно завершена! Деньги отправлены продавцу.');
      } else {
        WebApp.HapticFeedback.notificationOccurred('error');
        setStatusMessage(`Ошибка: ${data.message}`);
      }
    } catch (err) {
      WebApp.HapticFeedback.notificationOccurred('error');
      setStatusMessage('Критический сбой сети при подтверждении сделки');
    } finally {
      setLoading(false);
    }
  }, [loading, orderId, buyerId]);

  return (
    <div style={{
      background: '#0d0e12',
      color: '#fff',
      padding: '20px',
      borderRadius: '16px',
      fontFamily: 'sans-serif',
      border: '1px solid #1f222c',
      maxWidth: '400px',
      margin: '20px auto',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
    }}>
      {/* Верхняя телеметрия ордера */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
        <span style={{ color: '#626b7e', fontSize: '13px', fontFamily: 'monospace' }}>Ордер #{orderId.slice(0, 8)}</span>
        <span style={{
          color: status === OrderStatus.PAYMENT_HOLD ? '#ff9f43' : '#10ac84',
          fontSize: '13px',
          fontWeight: 'bold'
        }}>
          {status === OrderStatus.PAYMENT_HOLD ? '● В ГОЛД-ХОЛДЕ' : `● ${status}`}
        </span>
      </div>

      {/* Карточка скина */}
      <div style={{ marginBottom: '25px', textAlign: 'center' }}>
        <h2 style={{ margin: '0 0 8px 0', fontSize: '22px', color: '#fff', letterSpacing: '0.5px' }}>{skinName}</h2>
        <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#00d2d3', fontFamily: 'monospace' }}>{priceRubles} ₽</div>
        <div style={{ fontSize: '11px', color: '#57606f', marginTop: '6px', fontFamily: 'monospace' }}>SELLER_ID: {sellerId}</div>
      </div>

      {/* 🛑 БРОНИРОВАННЫЙ UX-ЩИТ БЕЗОПАСНОСТИ */}
      <div style={{
        background: 'rgba(238, 82, 83, 0.08)',
        border: '1px solid #ee5253',
        borderRadius: '12px',
        padding: '15px',
        marginBottom: '25px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '18px', marginRight: '8px' }}>🛑</span>
          <h4 style={{ color: '#ee5253', margin: 0, fontSize: '14px', fontWeight: 'bold', letterSpacing: '0.5px' }}>ВНИМАНИЕ! ЗАЩИТА ГАРАНТА</h4>
        </div>
        <p style={{ color: '#dcdde1', margin: 0, fontSize: '12px', lineHeight: '1.5' }}>
          **НЕ ПОДТВЕРЖДАЙТЕ** заказ до фактического получения товара в инвентаре Standoff 2!
          После клика голда безвозвратно улетит на баланс продавца.
        </p>
      </div>

      {/* Интерактивный тумблер верификации */}
      <label style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        cursor: 'pointer',
        fontSize: '12px',
        color: '#a4b0be',
        marginBottom: '20px',
        lineHeight: '1.4'
      }}>
        <input
          type="checkbox"
          checked={isItemReceived}
          disabled={loading}
          onChange={(e) => setIsItemReceived(e.target.checked)}
          style={{ marginTop: '3px', accentColor: '#00d2d3', width: '16px', height: '16px' }}
        />
        <span>Я лично проверил инвентарь внутри Standoff 2 и подтверждаю полное получение предмета.</span>
      </label>

      {/* Кнопка пуска транзакции */}
      <button
        onClick={handleConfirmDeal}
        disabled={!isItemReceived || loading}
        style={{
          width: '100%',
          padding: '15px',
          borderRadius: '10px',
          border: 'none',
          fontSize: '15px',
          fontWeight: 'bold',
          cursor: isItemReceived && !loading ? 'pointer' : 'not-allowed',
          background: isItemReceived && !loading ? 'linear-gradient(90deg, #10ac84, #1dd1a1)' : '#1f222c',
          color: isItemReceived && !loading ? '#fff' : '#57606f',
          transition: 'all 0.2s ease',
          boxShadow: isItemReceived && !loading ? '0 4px 20px rgba(29, 209, 161, 0.25)' : 'none'
        }}
      >
        {loading ? 'СВЯЗЬ С БЭКЕНДОМ...' : 'Получил товар, выдать деньги'}
      </button>

      {/* Слот системных логов */}
      {statusMessage && (
        <div style={{
          marginTop: '15px',
          padding: '10px',
          background: '#141519',
          borderRadius: '8px',
          fontSize: '11px',
          textAlign: 'center',
          color: '#eccc68',
          fontFamily: 'monospace',
          border: '1px solid #2f3542'
        }}>
          {`> ${statusMessage}`}
        </div>
      )}
    </div>
  );
};