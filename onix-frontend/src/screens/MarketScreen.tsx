import { useState, useMemo, useCallback } from 'react';
import WebApp from '@twa-dev/sdk';

export default function CreateProductScreen() {
  // Локальные стейты управления полями ввода UI
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("STANDOFF 2");
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  // 💸 Динамический расчет маржи ONIX (5% удержания с продавца при выводе)
  const calculation = useMemo(() => {
    const parsedPrice = parseFloat(price);
    if (isNaN(parsedPrice) || parsedPrice <= 0) return { fee: 0, payout: 0 };
    const fee = Math.round(parsedPrice * 0.05); // Скрытые 5% системы [PDF: 0.1.7]
    const payout = parsedPrice - fee;
    return { fee, payout: payout > 0 ? payout : 0 };
  }, [price]);

  // 🚀 БОЕВАЯ ОТПРАВКА ЛОТА В ОБЛАЧНУЮ СУБД NEON.TECH ЧЕРЕЗ NESTJS
  const handlePublishLot = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    const parsedPrice = parseFloat(price);
    if (!title.trim() || isNaN(parsedPrice) || parsedPrice <= 0) {
      WebApp.HapticFeedback.notificationOccurred('error');
      setStatusMessage("🚨 Ошибка: Заполните обязательные поля лота!");
      return;
    }

    // Защита кассы: Anti-Spike фильтр цен
    if (parsedPrice < 10 || parsedPrice > 50000) {
      WebApp.HapticFeedback.notificationOccurred('error');
      setStatusMessage("🚨 Ограничение: Цена должна быть от 10 до 50 000 ₽");
      return;
    }

    setLoading(true);
    setStatusMessage("Запись контракта в шину PostgreSQL...");

    try {
      // Забираем реальный ID юзера из Telegram SDK для сквозной привязки [проф. 1]
      let currentTgId = "7099007790"; // Твой дефолтный ID для тестов
      if (WebApp.initDataUnsafe?.user) {
        currentTgId = WebApp.initDataUnsafe.user.id.toString();
      }

      // Стреляем реальным fetch-пакетом в наш NestJS бэкенд [проф. 1]
      const response = await fetch('/api/products/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          price: parsedPrice,
          quantity: 1,
          category,
          sellerId: currentTgId // Передаем как селлер-токен под СУБД [проф. 1]
        })
      });

      const result = await response.json();

      if (response.ok) {
        // Успех: включаем жесткую победную вибрацию в руках трейдера!
        WebApp.HapticFeedback.notificationOccurred('success');
        setStatusMessage("🏆 ЛОТ УСПЕШНО ОПУБЛИКОВАН! Он уже доступен на общей витрине.");

        // Очищаем форму программно без мерцания и перезагрузки экрана [проф. 1]
        setTitle("");
        setDescription("");
        setPrice("");
      } else {
        throw new Error(result.message || "Ошибка валидации пакета");
      }
    } catch (err: any) {
      WebApp.HapticFeedback.notificationOccurred('error');
      setStatusMessage(`❌ Отказ сервера: ${err.message || 'Сбой сети'}`);
    } finally {
      setLoading(false);
    }
  }, [loading, title, price, category]);

  return (
    <div style={{ background: '#000', color: '#fff', minHeight: '100vh', padding: '16px', fontFamily: 'monospace', display: 'flex', flexDirection: 'column', gap: '15px' }}>

      {/* Верхний информационный щит */}
      <div style={{ background: '#0b0b0b', border: '1px solid #161616', padding: '14px', borderRadius: '4px' }}>
        <div style={{ fontSize: '11px', color: '#fff', fontWeight: 'bold' }}>// 📦 РАЗМЕСТИТЬ НОВЫЙ КОНТРАКТ НА ПРОДАЖУ</div>
        <div style={{ fontSize: '9px', color: '#555', letterSpacing: '0.5px', marginTop: '2px' }}>КОМИССИЯ ПРИ ПОКУПКЕ ДЛЯ ВСЕХ ПОЛЬЗОВАТЕЛЕЙ: 0%</div>
      </div>

      {/* Боевая форма публикации */}
      <div style={{ background: '#030303', border: '1px solid #1c1c1c', padding: '16px', borderRadius: '4px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <form onSubmit={handlePublishLot} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

          <input type="text" placeholder="НАЗВАНИЕ ТОВАРА (Напр: АВМ Скрэтч / 500 Робуксов)" value={title} onChange={(e) => setTitle(e.target.value)} style={{ background: '#000', border: '1px solid #222', padding: '12px', color: '#fff', fontSize: '12px', fontFamily: 'monospace', width: '100%', borderRadius: '4px' }} required disabled={loading} />

          <textarea placeholder="ПОДРОБНАЯ ИНСТРУКЦИЯ ПО ПЕРЕДАЧЕ ПРЕДМЕТА ПОКУПАТЕЛЮ" value={description} onChange={(e) => setDescription(e.target.value)} style={{ background: '#000', border: '1px solid #222', padding: '12px', color: '#fff', fontSize: '12px', fontFamily: 'monospace', height: '65px', resize: 'none', width: '100%', borderRadius: '4px' }} disabled={loading} />

          <div style={{ display: 'flex', gap: '10px' }}>
            <input type="number" placeholder="ЦЕНА (₽)" value={price} onChange={(e) => setPrice(e.target.value)} style={{ flex: 1, background: '#000', border: '1px solid #222', padding: '12px', color: '#fff', fontSize: '12px', fontFamily: 'monospace', borderRadius: '4px' }} required disabled={loading} />

            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ background: '#000', color: '#fff', border: '1px solid #222', padding: '12px', fontSize: '12px', fontFamily: 'monospace', borderRadius: '4px', cursor: 'pointer' }} disabled={loading}>
              <option value="STANDOFF 2">STANDOFF 2</option>
              <option value="STEAM">STEAM</option>
              <option value="RP ПРОЕКТЫ">RP ПРОЕКТЫ (GTA 5 / CRMP)</option>
              <option value="ROBLOX">ROBLOX</option>
              <option value="BRAWL STARS">BRAWL STARS</option>
              <option value="ДРУГОЕ">ДРУГОЕ</option>
            </select>
          </div>

          {/* Финтех-блок калькуляции прибыли продавца */}
          {calculation.payout > 0 && (
            <div style={{ background: 'rgba(0, 210, 211, 0.02)', border: '1px dashed #00d2d3', padding: '12px', borderRadius: '4px', fontSize: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#666' }}>
                <span>Скрытая маржа ONIX (5%):</span>
                <span style={{ color: '#ff4757' }}>-{calculation.fee} ₽</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', color: '#1dd1a1', borderTop: '1px solid #111', paddingTop: '4px', marginTop: '2px' }}>
                <span>Чистый доход упадёт вам на внутренний сейф:</span>
                <span>{calculation.payout} ₽</span>
              </div>
              <div style={{ fontSize: '9px', color: '#555', marginTop: '2px' }}>* Фиксированная пошлина 50 ₽ снимется банком строго в момент будущего вывода фиата на карту.</div>
            </div>
          )}

          <button type="submit" disabled={loading} style={{ backgroundColor: loading ? '#1a1a1a' : '#fff', color: loading ? '#555' : '#000', border: 'none', padding: '14px', fontSize: '12px', fontWeight: 'bold', cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: '0.5px', borderRadius: '4px', transition: 'all 0.3s' }}>
            {loading ? "СИНХРОНИЗАЦИЯ С БАЗОЙ..." : "🚀 ЗАПУСТИТЬ ЛОТ В ЭФИР ВИТРИНЫ"}
          </button>
        </form>

        {statusMessage && (
          <div style={{ fontSize: '10px', color: '#eccc68', textAlign: 'center', marginTop: '4px', fontFamily: 'monospace' }}>
            {`> STATUS: ${statusMessage}`}
          </div>
        )}
      </div>

    </div>
  );
}