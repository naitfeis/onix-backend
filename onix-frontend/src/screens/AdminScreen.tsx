import React, { useState } from 'react';

export const AdminScreen: React.FC = () => {
  const ADMIN_ID = "7099007790"; // Твой верифицированный Telegram ID вшит аппаратно

  const [targetUserId, setTargetUserId] = useState('');
  const [balanceAmount, setBalanceAmount] = useState('');
  const [logMessage, setLogMessage] = useState('');

  const handleUpdateBalance = async () => {
    try {
      const response = await fetch('/api/admin/user/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminId: ADMIN_ID,
          targetUserId: targetUserId,
          amountRubles: parseFloat(balanceAmount)
        })
      });
      const data = await response.json();
      setLogMessage(data.message || 'Баланс успешно обновлен');
    } catch (err) {
      setLogMessage('Критический сбой API при изменении баланса');
    }
  };

  const handleBanUser = async () => {
    try {
      const response = await fetch('/api/admin/user/ban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminId: ADMIN_ID,
          targetUserId: targetUserId
        })
      });
      const data = await response.json();
      setLogMessage(data.message || `Юзер ${targetUserId} забанен`);
    } catch (err) {
      setLogMessage('Критический сбой API при попытке бана');
    }
  };

  return (
    <div style={{
      background: '#0a0b0d',
      color: '#fff',
      padding: '20px',
      borderRadius: '16px',
      border: '1px solid #ff4757', // Красный неоновый щит админа
      fontFamily: 'monospace',
      maxWidth: '380px',
      margin: '20px auto'
    }}>
      <h3 style={{ color: '#ff4757', margin: '0 0 15px 0', textAlign: 'center' }}>👑 ONIX SYSTEM GOD-MODE</h3>

      <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'block', color: '#888', fontSize: '12px', marginBottom: '5px' }}>TARGET USER TELEGRAM ID:</label>
        <input
          type="text"
          value={targetUserId}
          onChange={(e) => setTargetUserId(e.target.value)}
          placeholder="Например: 7099007790"
          style={{ width: '100%', padding: '10px', background: '#141519', border: '1px solid #2f3542', color: '#fff', borderRadius: '8px' }}
        />
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', color: '#888', fontSize: '12px', marginBottom: '5px' }}>SET BALANCE (RUBLES):</label>
        <input
          type="number"
          value={balanceAmount}
          onChange={(e) => setBalanceAmount(e.target.value)}
          placeholder="Сумма: 5000"
          style={{ width: '100%', padding: '10px', background: '#141519', border: '1px solid #2f3542', color: '#fff', borderRadius: '8px' }}
        />
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
        <button
          onClick={handleUpdateBalance}
          style={{ flex: 1, padding: '12px', background: '#2ed573', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
        >
          Выставить баланс
        </button>
        <button
          onClick={handleBanUser}
          style={{ flex: 1, padding: '12px', background: '#ff4757', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
        >
          ВЫДАТЬ БАН
        </button>
      </div>

      {logMessage && (
        <div style={{ background: '#141519', padding: '10px', borderRadius: '6px', border: '1px solid #57606f', fontSize: '11px', color: '#eccc68' }}>
          {`> STATUS: ${logMessage}`}
        </div>
      )}
    </div>
  );
};