import React, { useState, useEffect, useMemo, useCallback } from 'react';
import WebApp from '@twa-dev/sdk'; // Нативный запуск Telegram SDK

export default function CreateProductScreen() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [category, setCategory] = useState("STANDOFF 2");
  const [userId, setUserId] = useState("1"); // Наш внутренний ID из базы Postgres
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  // 🛰️ ИНТЕГРАЦИЯ С ТГ-БОТОМ: Подтягиваем реальные данные пацана из сессии
  useEffect(() => {
    if (WebApp.initDataUnsafe?.user) {
      // Ищем профиль в нашей базе по Telegram ID
      fetch(`/api/users/profile?tgId=${WebApp.initDataUnsafe.user.id}`)
        .then(res => res.json())
        .then(res => {
          if (res.success) setUserId(res.data.id.toString());
        })
        .catch(() => console.error("Ошибка привязки сессии к Neon.tech"));
    }
  }, []);

  // 💸 СИНЬОР-ФИЧА: Динамический расчет чистой выплаты продавца с учетом твоей маржи 2%
  const calculation = useMemo(() => {
    const parsedPrice = parseFloat(price);
    if (isNaN(parsedPrice) || parsedPrice <= 0) return { fee: 0, payout: 0 };

    const fee = Math.round(parsedPrice * 0.02); // Твоя 2% маржа Гаранта
    const payout = parsedPrice - fee;           // Что чистыми получит пацан на баланс
    return { fee, payout };
  }, [price]);

  // 🚀 ПУЛЕНЕПРОБИВАЕМАЯ ОТПРАВКА ЛОТА НА БЭКЕНД
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    if (!title.trim() || !price) {
      WebApp.HapticFeedback.notificationOccurred('error');
      setStatusMessage("🚨 Ошибка: Заполните обязательные поля лота!");
      return;
    }

    setLoading(true);
    setStatusMessage("Синхронизация с реестром PostgreSQL...");

    try {
      // Отправляем пакет строго на эндпоинт нашего ProductController бэкенда
      const response = await fetch('/api/products/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          price: parseFloat(price),
          quantity: parseInt(quantity) || 1,
          category,
          sellerId: userId // ИСПРАВЛЕНО: передаем строго как sellerId под DTO бэкенда!
        })
      });

      const result = await response.json();

      if (response.ok) {
        // Успех: Включаем жесткую победную вибрацию в руках пацана!
        WebApp.HapticFeedback.notificationOccurred('success');
        setStatusMessage(`🏆 ЛОТ УСПЕШНО ВЫСТАВЛЕН НА БИРЖУ ONIX! Срок публикации: 30 суток.`);

        // Синьор-маневр: Очищаем поля формы программно без перезагрузки страницы!
        setTitle("");
        setDescription("");
        setPrice("");
        setQuantity("1");
      } else {
        WebApp.HapticFeedback.notificationOccurred('error');
        setStatusMessage(`🚨 Отказ сервера: ${result.message || 'Ошибка валидации пакета'}`);
      }
    } catch (err) {
      WebApp.HapticFeedback.notificationOccurred('error');
      setStatusMessage("❌ Критический сбой сети при отправке пакета в Neon.tech");
    } finally {
      setLoading(false);
    }
  }, [loading, title, price, quantity, category, userId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', background: '#000', minHeight: '100vh', padding: '12px' }}>

      {/* Шапка информационного щита */}
      <div style={{ background: '#0b0b0b', border: '1px solid #161616', padding: '14px', borderRadius: '4px' }}>
        <div style={{ fontSize: '11px', color: '#fff', fontWeight: 'bold', fontFamily: 'monospace', marginBottom: '4px' }}>// 📦 ВЫСТАВИТЬ СВОЙ ТОВАР НА БИРЖУ</div>
        <div style={{ fontSize: '9px', color: '#555', letterSpacing: '0.5px', fontFamily: 'monospace' }}>СРОК ХРАНЕНИЯ КОНТРАКТА В БАЗЕ ДАННЫХ: 30 ДНЕЙ</div>
      </div>

      {/* Боевая форма создания лота */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px', backgroundColor: '#030303', border: '1px solid #222', padding: '16px', borderRadius: '4px' }}>

        <input type="text" placeholder="НАЗВАНИЕ ТОВАРА (Напр: M9 Bayonet Dragon Glass)" value={title} onChange={(e) => setTitle(e.target.value)} style={{ background: '#000', border: '1px solid #222', padding: '12px', color: '#fff', fontSize: '12px', fontFamily: 'monospace', width: '100%', borderRadius: '4px' }} required />

        <textarea placeholder="ОПИСАНИЕ СПОСОБА ПЕРЕДАЧИ ПРЕДМЕТА В ИГРЕ" value={description} onChange={(e) => setDescription(e.target.value)} style={{ background: '#000', border: '1px solid #222', padding: '12px', color: '#fff', fontSize: '12px', fontFamily: 'monospace', height: '60px', resize: 'none', width: '100%', borderRadius: '4px' }} />

        <div style={{ display: 'flex', gap: '10px' }}>
          <input type="number" placeholder="ЦЕНА (₽)" value={price} onChange={(e) => setPrice(e.target.value)} style={{ flex: 1, background: '#000', border: '1px solid #222', padding: '12px', color: '#fff', fontSize: '12px', fontFamily: 'monospace', borderRadius: '4px' }} required />
          <input type="number" placeholder="КОЛ-ВО" value={quantity} onChange={(e) => setQuantity(e.target.value)} style={{ width: '80px', background: '#000', border: '1px solid #222', padding: '12px', color: '#fff', fontSize: '12px', fontFamily: 'monospace', borderRadius: '4px' }} />
        </div>

        {/* 💸 ИНТРАКТИВНЫЙ ФИНТЕХ-ОТЧЕТ ДЛЯ ПРОДАВЦА */}
        {calculation.payout > 0 && (
          <div style={{ background: 'rgba(0, 210, 211, 0.05)', border: '1px solid #00d2d3', padding: '12px', borderRadius: '4px', fontFamily: 'monospace', fontSize: '11px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#888', marginBottom: '4px' }}>
              <span>Маржа Гаранта ONIX (2%):</span>
              <span style={{ color: '#ff4757' }}>-{calculation.fee} ₽</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', color: '#1dd1a1' }}>
              <span>Вы получите чистыми на баланс:</span>
              <span>{calculation.payout} ₽</span>
            </div>
          </div>
        )}

        <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ background: '#000', color: '#fff', border: '1px solid #222', padding: '12px', fontSize: '12px', fontFamily: 'monospace', borderRadius: '4px', cursor: 'pointer' }}>
          <option value="STANDOFF 2">STANDOFF 2</option>
          <option value="ROBLOX">ROBLOX</option>
          <option value="APEX LEGENDS">APEX LEGENDS</option>
        </select>

        <button type="submit" disabled={loading} style={{ backgroundColor: loading ? '#222' : '#fff', color: loading ? '#555' : '#000', border: 'none', padding: '14px', fontSize: '12px', fontWeight: 'bold', cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: '1px', transition: 'all 0.3s ease', borderRadius: '4px' }}>
          {loading ? "ПАТРОНЫ УЛЕТАЮТ..." : "🔥 ВЫСТАВИТЬ НА ПРОДАЖУ"}
        </button>
      </form>

      {/* Вывод логов ответа от бэкенда */}
      {statusMessage && (
        <div style={{ padding: '12px', background: '#0b0b0b', border: '1px solid #222', borderRadius: '4px', fontSize: '11px', textAlign: 'center', color: '#eccc68', fontFamily: 'monospace' }}>
          {`> ${statusMessage}`}
        </div>
      )}
    </div>
  );
}