import React, { useState, useMemo, useCallback } from 'react';
import { useMarketCore } from '../hooks/useMarketCore';

// 🚀 СИНЬОР-ФИКС TS1484: Экспортируем строгие интерфейсы логов под флаг verbatimModuleSyntax
export type IProduct = {
  id: string;
  title: string;
  description: string;
  priceCents: string;
  category: string;
  sellerId: string;
  sellerNick: string;
  status: 'ACTIVE' | 'RESERVED' | 'SOLD_OUT';
};

export type IOrder = {
  id: string;
  productId: string;
  productTitle: string;
  priceCents: string;
  buyerId: string;
  sellerId: string;
  sellerNick: string;
  status: 'PAYMENT_HOLD' | 'DELIVERING' | 'COMPLETED' | 'CANCELED' | 'DISPUTE';
};

export default function MarketScreen() {
  //  satellites ПОДКЛЮЧАЕМ НАШ ВЫСОКОТЕХНОЛОГИЧНЫЙ МАРКЕТ-ХУК К КЛАССАМ UI
   const {
    liveBalanceRubles,
    currentUserNick,
    products,
    orders,
    selectedProduct,
    setSelectedProduct,
    createProductLog,
    handleBuyProduct,     // Прямой вызов клиринга [проф. 1]
    handleSellerSent,
    handleConfirmReceive,
    handleOpenDispute
  } = useMarketCore();

  // ⚔️ Возвращаем функцию-обертку мгновенного авто-переноса
  const buyAndSwitchToChat = useCallback((product: IProduct) => {
    handleBuyProduct(product); // Списываем демо-баланс и холдируем лот [проф. 1]
  }, [handleBuyProduct]);

  // Заглушка лоадера, чтобы убрать ошибку 'Cannot find name purchaseLoading' [проф. 1]
  const purchaseLoading = false;

  // Локальные стейты сугубо для полей ввода формы UI (Слой представления)
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("STANDOFF 2");
  const [statusMessage, setStatusMessage] = useState("");

  // 💸 СИНЬОР-МАНЕВР: Расчет спреда маржи 5% и фиксированной выплаты 50 ₽ для UI-подсказок
  const calculation = useMemo(() => {
    const parsedPrice = parseFloat(price);
    if (isNaN(parsedPrice) || parsedPrice <= 0) return { fee: 0, fixFee: 50, payout: 0 };

    const fee = Math.round(parsedPrice * 0.05); // Скрытые 5% системы ONIX [PDF: 0.1.7]
    const fixFee = 50;                          // Фиксированная выплата банка за СБП
    const payout = parsedPrice - fee - fixFee;

    return { fee, fixFee, payout: payout > 0 ? payout : 0 };
  }, [price]);

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !price) return;

    // Передаем данные в хук для мгновенного сохранения в Postgres-слой
    createProductLog(title.trim(), description.trim(), price, category);
    setStatusMessage("🏆 Лот успешно выставлен на маркет ONIX!");
    setTitle("");
    setDescription("");
    setPrice("");
  };

  return (
    <div style={{ background: '#000', color: '#fff', minHeight: '100vh', padding: '16px', fontFamily: 'monospace', display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* 📊 ФИНТЕХ-БАННЕР БАЛАНСА ПОД ФАНПЕЙ */}
      <div style={{ background: '#070707', border: '1px solid #161616', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '4px' }}>
        <div>
          <div style={{ fontSize: '9px', color: '#555', letterSpacing: '0.5px' }}>ВАШ ДЕМО-БАЛАНС (FUNPAY MODE):</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1dd1a1', marginTop: '4px' }}>{liveBalanceRubles.toFixed(2)} ₽</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '9px', color: '#555', letterSpacing: '0.5px' }}>АККАУНТ ТРЕЙДЕРА:</div>
          <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#00d2d3', marginTop: '4px' }}>@{currentUserNick}</div>
        </div>
      </div>

      {/* 📦 ФОРМА ВЫСТАВЛЕНИЯ ТОВАРА НА ПРОДАЖУ */}
      <div style={{ background: '#030303', border: '1px solid #1c1c1c', padding: '16px', borderRadius: '4px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ fontSize: '11px', color: '#fff', fontWeight: 'bold' }}>// 🛒 ВЫСТАВИТЬ ЛОТ НА ПРОДАЖУ (ПРОДАВЕЦ)</div>

        <form onSubmit={handleSubmitForm} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <input type="text" placeholder="НАЗВАНИЕ ТОВАРА" value={title} onChange={(e) => setTitle(e.target.value)} style={{ background: '#000', border: '1px solid #222', padding: '12px', color: '#fff', fontSize: '12px', fontFamily: 'monospace', width: '100%', borderRadius: '4px' }} required />
          <textarea placeholder="ОПИСАНИЕ ИГРОВОГО ПРОЦЕССА ПЕРЕДАЧИ" value={description} onChange={(e) => setDescription(e.target.value)} style={{ background: '#000', border: '1px solid #222', padding: '12px', color: '#fff', fontSize: '12px', fontFamily: 'monospace', height: '45px', resize: 'none', width: '100%', borderRadius: '4px' }} />

          <div style={{ display: 'flex', gap: '10px' }}>
            <input type="number" placeholder="ЦЕНА (₽)" value={price} onChange={(e) => setPrice(e.target.value)} style={{ flex: 1, background: '#000', border: '1px solid #222', padding: '12px', color: '#fff', fontSize: '12px', fontFamily: 'monospace', borderRadius: '4px' }} required />
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ background: '#000', color: '#fff', border: '1px solid #222', padding: '12px', fontSize: '12px', fontFamily: 'monospace', borderRadius: '4px', cursor: 'pointer' }}>
              <option value="STANDOFF 2">STANDOFF 2</option>
              <option value="ROBLOX">ROBLOX</option>
            </select>
          </div>

            {calculation.fee > 0 && (
            <div style={{ background: 'rgba(0, 210, 211, 0.03)', border: '1px dashed #00d2d3', padding: '10px', borderRadius: '4px', fontSize: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#666' }}>
                <span>Скрытая маржа ONIX (5%):</span>
                <span style={{ color: '#ff4757' }}>-{calculation.fee} ₽</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#666', marginTop: '2px' }}>
                <span>Комиссия за мгновенный вывод:</span>
                <span style={{ color: '#ff4757' }}>-50.00 ₽</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', color: '#1dd1a1', marginTop: '4px' }}>
                <span>Продавец получит чистыми:</span>
                <span>{calculation.payout} ₽</span>
              </div>
            </div>
          )}

          <button type="submit" style={{ backgroundColor: '#fff', color: '#000', border: 'none', padding: '14px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', letterSpacing: '1px', borderRadius: '4px' }}>
            🔥 ВЫСТАВИТЬ НА ФАНПЕЙ-МАРКЕТ
          </button>
        </form>
        {statusMessage && <div style={{ fontSize: '10px', color: '#eccc68', textAlign: 'center', marginTop: '4px' }}>{`> ${statusMessage}`}</div>}
      </div>

      {/* ⚔️ ЦЕНТРАЛЬНАЯ ТАБЛИЦА АКТИВНЫХ СДЕЛОК (КОНТУР ГАРАНТА С МГНОВЕННОЙ ВЫПЛАТОЙ) */}
      {orders.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ fontSize: '11px', color: '#ff9f43', fontWeight: 'bold' }}>// 🔒 ВАШИ АКТИВНЫЕ КОНТРАКТЫ ГАРАНТА:</div>
          {orders.map(order => {
            const priceRub = parseInt(order.priceCents, 10) / 100;
            return (
              <div key={order.id} style={{ background: '#050508', border: '1px solid #111', padding: '14px', borderRadius: '4px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ fontWeight: 'bold', color: '#fff' }}>{order.productTitle}</span>
                  <span style={{ color: '#00d2d3', fontWeight: 'bold' }}>{priceRub} ₽</span>
                </div>
                <div style={{ fontSize: '10px', color: '#666' }}>
                  Статус: <strong style={{ color: order.status === 'DISPUTE' ? '#ff4757' : '#ff9f43' }}>{order.status}</strong> | Продавец: @{order.sellerNick}
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  {order.status === 'PAYMENT_HOLD' && (
                    <button onClick={() => handleSellerSent(order.id)} style={{ flex: 1, background: '#ff9f43', color: '#000', border: 'none', padding: '8px', fontSize: '11px', fontWeight: 'bold', borderRadius: '4px', cursor: 'pointer' }}>
                      📦 Я передал предмет в игре (Продавец)
                    </button>
                  )}

                  {order.status === 'DELIVERING' && (
                    <>
                      <button onClick={() => handleConfirmReceive(order)} style={{ flex: 2, background: '#1dd1a1', color: '#000', border: 'none', padding: '8px', fontSize: '11px', fontWeight: 'bold', borderRadius: '4px', cursor: 'pointer' }}>
                        ✅ Подтвердить получение (Мгновенная выплата -50₽)
                      </button>
                      <button onClick={() => handleOpenDispute(order.id)} style={{ flex: 1, background: '#ff4757', color: '#fff', border: 'none', padding: '8px', fontSize: '11px', fontWeight: 'bold', borderRadius: '4px', cursor: 'pointer' }}>
                        🚨 СПОР
                      </button>
                    </>
                  )}

                  {order.status === 'DISPUTE' && (
                    <div style={{ color: '#ff4757', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', width: '100%', background: 'rgba(255,71,87,0.05)', padding: '6px', border: '1px solid #ff4757' }}>⚖️ ОЖИДАНИЕ ВЕРДИКТА CEO ONIX. СДЕЛКА ЗАМОРОЖЕНА.</div>
                  )}

                  {order.status === 'COMPLETED' && (
                    <div style={{ color: '#1dd1a1', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', width: '100%' }}>🏆 Ордер закрыт. Капитал распределен мгновенно.</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ fontSize: '11px', color: '#555' }}>
          // 🌐 ДОСТУПНЫЕ ПРЕДЛОЖЕНИЯ ТРЕЙДЕРОВ:
        </div>

        {products.filter(p => p.status === 'ACTIVE').length === 0 ? (
          <div style={{ color: '#333', fontSize: '11px', textAlign: 'center', padding: '30px', border: '1px dashed #1a1a1a' }}>
            Маркет пуст. Добавьте лот через форму выше!
          </div>
        ) : (
          products.filter(p => p.status === 'ACTIVE').map((product: IProduct) => {
            const priceInRubles = parseInt(product.priceCents, 10) / 100;
            return (
              <div
                key={product.id}
                onClick={() => setSelectedProduct(product)}
                style={{
                  background: '#050505',
                  border: '1px solid #1c1c1c',
                  padding: '14px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <div>
                  <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', color: '#fff', fontWeight: 'bold' }}>
                    {product.title}
                  </h4>
                  <div style={{ fontSize: '10px', color: '#444' }}>
                    Продавец: @{product.sellerNick}
                  </div>
                </div>
                <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#00d2d3' }}>
                  {priceInRubles} ₽
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 📑 СИНЬОР-ШТОРКА СДЕЛКИ ФАНПЕЯ */}
      {selectedProduct && (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            background: '#0a0a0c',
            borderTop: '1px solid #222',
            padding: '20px',
            borderTopLeftRadius: '12px',
            borderTopRightRadius: '12px',
            boxShadow: '0 -10px 40px rgba(0,0,0,0.8)',
            zIndex: 999,
            display: 'flex',
            flexDirection: 'column',
            gap: '15px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span style={{ fontSize: '9px', background: '#1c1c1c', padding: '3px 6px', borderRadius: '4px', color: '#666' }}>
                {selectedProduct.category}
              </span>
              <h3 style={{ margin: '10px 0 4px 0', color: '#fff', fontSize: '18px' }}>
                {selectedProduct.title}
              </h3>
              <p style={{ margin: 0, fontSize: '12px', color: '#888', lineHeight: '1.4' }}>
                {selectedProduct.description || 'Способ передачи не указан.'}
              </p>
            </div>

            <button
              onClick={() => setSelectedProduct(null)}
              style={{ background: 'none', border: 'none', color: '#444', fontSize: '18px', cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>

          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#00d2d3' }}>
            {(parseInt(selectedProduct.priceCents, 10) / 100)} ₽
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>

            {/* Кнопка ОБСУДИТЬ ЛОТ */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                alert(`💬 Открытие приватного изолированного чата с продавцом @${selectedProduct.sellerNick}`);
              }}
              style={{
                flex: 1,
                padding: '14px',
                background: '#141519',
                color: '#fff',
                border: '1px solid #222',
                borderRadius: '4px',
                fontWeight: 'bold',
                cursor: 'pointer',
                fontSize: '12px',
                fontFamily: 'monospace'
              }}
            >
              💬 ОБСУДИТЬ ЛОТ
            </button>

               {/* Кнопка 2: Купить с Гарантом */}
            <button
              onClick={() => buyAndSwitchToChat(selectedProduct)}
              disabled={purchaseLoading}
              style={{ flex: 1, padding: '14px', background: purchaseLoading ? '#222' : 'linear-gradient(90deg, #00d2d3, #00a8ff)', color: purchaseLoading ? '#555' : '#fff', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: purchaseLoading ? 'not-allowed' : 'pointer', fontSize: '12px', fontFamily: 'monospace' }}
            >
              {purchaseLoading ? 'ХОЛДИРОВАНИЕ...' : '⚔️ КУПИТЬ С ГАРАНТОМ'}
            </button>

          </div>
        </div>
      )}

    </div>
  );
}
