import { useEffect, useState } from 'react';

// Строгий контракт данных профиля, возвращаемых NestJS [проф. 1]
interface IOnixUser {
  id: string;
  telegramNick: string | null;
  balanceMain: string;   // Реальный баланс продавца для вывода
  balanceBonus: string;  // Бонусы Кибер-Фермы
}

export default function ProfileScreen() {
  const [dbUser, setDbUser] = useState<IOnixUser | null>(null);
  const [tgUser, setTgUser] = useState<{ name: string; photo: string }>({
    name: 'ONIX TRADER',
    photo: 'https://placehold.co' // Дефолтная заглушка для ПК браузера
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Считываем точные настройки из Telegram Web App и NestJS при старте [проф. 1]
  useEffect(() => {
    const initProfile = async () => {
      try {
        let currentTgId = "1"; // ID для тестов в обычном браузере PyCharm

        // 1. Вытягиваем живую аватарку и имя из сессии Telegram Web App [проф. 1]
        const tgWebApp = (window as any).Telegram?.WebApp;
        if (tgWebApp) {
          tgWebApp.ready();
          if (tgWebApp.initDataUnsafe?.user) {
            const user = tgWebApp.initDataUnsafe.user;
            currentTgId = user.id.toString();
            setTgUser({
              name: user.username ? `@${user.username}` : `${user.first_name} ${user.last_name || ''}`.trim(),
              photo: user.photo_url || 'https://placehold.co'
            });
          }
        }

        // 2. Стучимся на NestJS бэкенд за балансом и ID из PostgreSQL [проф. 1]
        const response = await fetch(`/api/users/profile?tgId=${currentTgId}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) throw new Error('Ошибка клиринга профиля СУБД');
        const result = await response.json(); // Распаковываем OnixApiResponse [проф. 1]

        if (result.success) {
          setDbUser(result.data);
        } else {
          throw new Error('Бэкенд отклонил запрос авторизации.');
        }
      } catch (err: any) {
        setError(err.message || 'Критический сбой сети маркетплейса');
      } finally {
        setLoading(false);
      }
    };

    initProfile().catch(console.error); // Исправлено: Добавили перехват для промиса [проф. 1]
  }, []);

  // ФУНКЦИЯ МОМЕНТАЛЬНОГО ВЫВОДА КЭША СО СКРЫТОЙ МАРЖОЙ 2% [проф. 1]
  const handleWithdraw = async () => {
    if (!dbUser) return;

    const amountStr = prompt("Введите сумму вывода на карту (Минимум 100 ₽):");
    if (!amountStr) return;

    const amount = parseInt(amountStr);
    if (isNaN(amount) || amount < 100) {
      alert("Ошибка: Минимальная сумма вывода из сети ONIX — 100 ₽");
      return;
    }

    try {
      // Стучимся на наш пуленепробиваемый NestJS эндпоинт [проф. 1]
      const response = await fetch('/api/market/complete-instant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyerId: dbUser.id, // ID пользователя, запрашивающего вывод
          orderId: "1"        // Тестовый ID ордера для закрытия выплаты в альфа-версии
        })
      });

      if (!response.ok) throw new Error('Шлюз выплат отклонил транзакцию ФЗ-115');
      const result = await response.json();

      if (result.success) {
        alert(`⚡️ Перевод запущен! На вашу карту будет зачислено: ${result.data.finalPayoutAmount} ₽. Проверьте баланс и бот!`);
        window.location.reload();
      }
    } catch (err: any) {
      alert(`❌ Ошибка шлюза выплат: ${err.message}`);
    }
  };

  // Проверяем роль администратора по твоему кастомному логину
  const isAdmin = tgUser.name.toLowerCase().includes('shop_rub') || tgUser.name.toLowerCase().includes('max_ceo');

  if (loading) return <div style={{ color: '#fff', textAlign: 'center', marginTop: '20px', fontFamily: 'monospace' }}>LOADING ONIX ENGINE...</div>;
  if (error) return <div style={{ color: '#ff3333', textAlign: 'center', marginTop: '20px', fontFamily: 'monospace' }}>❌ ERROR: {error}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* ✅ ЖИВАЯ СИНХРОНИЗИРОВАННАЯ ШАПКА АКТИВНОГО ТРЕЙДЕРА */}
      <div style={{
        border: '1px solid #222',
        padding: '14px',
        backgroundColor: '#030303',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px'
      }}>
        {/* Левая часть: Динамическая аватарка + Никнейм + Роль */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ position: 'relative', width: '42px', height: '42px', flexShrink: 0 }}>
            <img
              src={tgUser.photo}
              alt="Avatar"
              style={{ width: '100%', height: '100%', border: '1px solid #fff', objectFit: 'cover' }}
            />
            <div style={{
              position: 'absolute', top: '-6px', right: '-6px',
              backgroundColor: '#000', border: '1px solid #fff', borderRadius: '50%',
              width: '18px', height: '18px', display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontSize: '10px'
            }}>
              {isAdmin ? '👑' : '👤'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>
              {tgUser.name}
            </div>
            <div style={{ fontSize: '9px', color: isAdmin ? '#b57cff' : '#81c784', fontWeight: 'bold', marginTop: '2px' }}>
              {isAdmin ? `👑 АДМИН (ID: ${dbUser?.id})` : `👤 ACC: №${dbUser?.id || '1'}`}
            </div>
          </div>
        </div>

        {/* Правая часть: Динамический баланс из Prisma PostgreSQL + Моментальный вывод */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', textAlign: 'right' }}>
          <div>
            <div style={{ fontSize: '8px', color: '#555', letterSpacing: '0.5px' }}>БАЛАНС</div>
            <strong style={{ fontSize: '14px', color: '#81c784', fontWeight: '900' }}>
              {dbUser ? parseFloat(dbUser.balanceMain || '0').toFixed(2) : '0.00'} ₽
            </strong>
          </div>
          <button
            onClick={handleWithdraw}
            style={{
              backgroundColor: '#000',
              color: '#81c784',
              border: '1px solid #81c784',
              padding: '8px 12px',
              fontFamily: '"Courier New", monospace',
              fontWeight: 'bold',
              fontSize: '11px',
              cursor: 'pointer'
            }}
          >
            💳 ВЫВОД
          </button>
        </div>

      </div>

      {/* 📦 2. МОИ ВЫСТАВЛЕННЫЕ ПРЕДЛОЖЕНИЯ */}
      <div style={{ border: '1px solid #222', padding: '16px', backgroundColor: '#030303' }}>
        <div style={{ fontSize: '11px', color: '#fff', fontWeight: 'bold', marginBottom: '12px' }}>// 📦 МОИ ВЫСТАВЛЕННЫЕ ПРЕДЛОЖЕНИЯ</div>
        {/* ИСПРАВЛЕНО: Заменили justifycontent и alignitems на валидный camelCase [проф. 1] */}
        <div style={{ border: '1px solid #333', padding: '12px', backgroundColor: '#000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 'bold' }}>1,000 ROBUX [FAST]</div>
            <div style={{ fontSize: '10px', color: '#555', marginTop: '2px' }}>Категория: ROBLOX // В наличии: 3 шт.</div>
          </div>
          <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#81c784' }}>790 ₽</span>
        </div>
      </div>

      {/* ⭐️ 3. ПОСЛЕДНИЕ ОТЗЫВЫ КЛИЕНТОВ */}
      <div style={{ border: '1px solid #222', padding: '16px', backgroundColor: '#030303' }}>
        <div style={{ fontSize: '11px', color: '#fff', fontWeight: 'bold', marginBottom: '12px' }}>// ⭐️ ПОСЛЕДНИЕ ОТЗЫВЫ КЛИЕНТОВ</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ borderBottom: '1px solid #1c1c1c', paddingBottom: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
              <span style={{ color: '#81c784', fontWeight: 'bold' }}>⭐️⭐️⭐️⭐️⭐️ (5/5)</span>
              <span style={{ color: '#444' }}>@gamer_pro</span>
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#aaa' }}>Все отлично! Голда прилетела моментально, продавец вежливый.</p>
          </div>
        </div>
      </div>

    </div>
  );
}