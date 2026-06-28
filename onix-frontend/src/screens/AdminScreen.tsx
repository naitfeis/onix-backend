import { useState } from 'react';
import WebApp from '@twa-dev/sdk';

const getInitData = () => { try { return WebApp.initData || ''; } catch { return ''; } };

export default function AdminScreen() {
  const ADMIN_TG_ID = import.meta.env.VITE_ADMIN_TG_ID as string ?? '';

  const [targetTgId, setTargetTgId]     = useState('');
  const [balanceAmount, setBalanceAmount] = useState('');
  const [log, setLog]                   = useState('');
  const [loading, setLoading]           = useState(false);

  const post = async (path: string, body: object) => {
    setLoading(true);
    setLog('Выполнение...');
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': getInitData() },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setLog(data.data?.message ?? (res.ok ? 'Готово' : `Ошибка: ${data.message}`));
    } catch {
      setLog('Критический сбой сети');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: '#0a0b0d', color: '#fff', padding: '20px', borderRadius: '4px', border: '1px solid #ff4757', fontFamily: 'monospace' }}>
      <h3 style={{ color: '#ff4757', margin: '0 0 16px 0', textAlign: 'center', fontSize: '13px' }}>👑 ONIX GOD-MODE PANEL</h3>

      <label style={{ display: 'block', color: '#666', fontSize: '10px', marginBottom: '5px' }}>TARGET TELEGRAM ID:</label>
      <input
        type="text" value={targetTgId} onChange={e => setTargetTgId(e.target.value)}
        placeholder="7099007790" disabled={loading}
        style={{ width: '100%', padding: '10px', background: '#141519', border: '1px solid #2f3542', color: '#fff', borderRadius: '4px', fontFamily: 'monospace', fontSize: '12px', marginBottom: '12px', boxSizing: 'border-box' }}
      />

      <label style={{ display: 'block', color: '#666', fontSize: '10px', marginBottom: '5px' }}>SET BALANCE (₽):</label>
      <input
        type="number" value={balanceAmount} onChange={e => setBalanceAmount(e.target.value)}
        placeholder="5000" disabled={loading}
        style={{ width: '100%', padding: '10px', background: '#141519', border: '1px solid #2f3542', color: '#fff', borderRadius: '4px', fontFamily: 'monospace', fontSize: '12px', marginBottom: '16px', boxSizing: 'border-box' }}
      />

      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        <button disabled={loading || !targetTgId || !balanceAmount} onClick={() =>
          post('/api/admin/user/balance', { adminTgId: ADMIN_TG_ID, targetTgId, amountRubles: parseFloat(balanceAmount) })
        } style={btnStyle('#2ed573', loading)}>
          💰 Баланс
        </button>
        <button disabled={loading || !targetTgId} onClick={() =>
          post('/api/admin/user/ban', { adminTgId: ADMIN_TG_ID, targetTgId })
        } style={btnStyle('#ff4757', loading)}>
          🚫 Бан
        </button>
        <button disabled={loading || !targetTgId} onClick={() =>
          post('/api/admin/user/unban', { adminTgId: ADMIN_TG_ID, targetTgId })
        } style={btnStyle('#ff9f43', loading)}>
          ✅ Разбан
        </button>
      </div>

      {log && (
        <div style={{ background: '#141519', padding: '10px', borderRadius: '4px', border: '1px solid #2f3542', fontSize: '10px', color: '#eccc68' }}>
          {'> '}{log}
        </div>
      )}
    </div>
  );
}

const btnStyle = (color: string, disabled: boolean): React.CSSProperties => ({
  flex: 1, padding: '10px', background: disabled ? '#1a1a1a' : color,
  color: disabled ? '#555' : '#fff', border: 'none', borderRadius: '4px',
  fontWeight: 'bold', fontSize: '10px', cursor: disabled ? 'not-allowed' : 'pointer',
  fontFamily: 'monospace',
});