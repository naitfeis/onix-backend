import { useState, useMemo, useCallback } from 'react';
import WebApp from '@twa-dev/sdk';
import { useMarketCore } from '../hooks/useMarketCore';

const CATEGORIES = ['STANDOFF 2', 'STEAM', 'RP ПРОЕКТЫ', 'ROBLOX', 'BRAWL STARS', 'ДРУГОЕ'];

interface Props {
  tgId: string;
  onSuccess?: () => void;
}

export default function CreateProductScreen({ tgId, onSuccess }: Props) {
  const { createProduct } = useMarketCore(tgId);

  const [title, setTitle]             = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice]             = useState('');
  const [category, setCategory]       = useState('STANDOFF 2');
  const [loading, setLoading]         = useState(false);
  const [status, setStatus]           = useState('');

  const calc = useMemo(() => {
    const p = parseFloat(price);
    if (isNaN(p) || p <= 0) return null;
    return { gross: p, net: p.toFixed(2) }; // комиссия 0%
  }, [price]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setStatus('Отправка в базу данных...');

    const ok = await createProduct(title.trim(), description.trim(), price, category);

    if (ok) {
      try { WebApp.HapticFeedback.notificationOccurred('success'); } catch {}
      setStatus('🏆 Лот опубликован! Уже виден на витрине.');
      setTitle(''); setDescription(''); setPrice('');
      setTimeout(() => { onSuccess?.(); }, 1500);
    } else {
      setStatus('');
    }
    setLoading(false);
  }, [loading, title, description, price, category, createProduct, onSuccess]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

      <div style={{ background: '#0b0b0b', border: '1px solid #161616', padding: '12px', borderRadius: '4px' }}>
        <div style={{ fontSize: '11px', color: '#fff', fontWeight: 'bold' }}>// 📦 РАЗМЕСТИТЬ ЛОТ</div>
        <div style={{ fontSize: '9px', color: '#555', marginTop: '2px' }}>КОМИССИЯ ПРИ ПРОДАЖЕ: 0%</div>
      </div>

      <div style={{ background: '#030303', border: '1px solid #1c1c1c', padding: '16px', borderRadius: '4px' }}>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

          <input
            type="text" placeholder="НАЗВАНИЕ (напр: AWM Скрэтч / 500 Робуксов)"
            value={title} onChange={e => setTitle(e.target.value)}
            disabled={loading} required minLength={5} maxLength={80}
            style={inputStyle}
          />

          <textarea
            placeholder="ОПИСАНИЕ / ИНСТРУКЦИЯ ПО ПЕРЕДАЧЕ"
            value={description} onChange={e => setDescription(e.target.value)}
            disabled={loading}
            style={{ ...inputStyle, height: '65px', resize: 'none' }}
          />

          <div style={{ display: 'flex', gap: '10px' }}>
            <input
              type="number" placeholder="ЦЕНА (₽)" min={10} max={50000} step="0.01"
              value={price} onChange={e => setPrice(e.target.value)}
              disabled={loading} required
              style={{ ...inputStyle, flex: 1 }}
            />
            <select
              value={category} onChange={e => setCategory(e.target.value)}
              disabled={loading}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {calc && (
            <div style={{ background: 'rgba(29,209,161,0.03)', border: '1px dashed #1dd1a1', padding: '10px', borderRadius: '4px', fontSize: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#1dd1a1', fontWeight: 'bold' }}>
                <span>Упадёт на баланс (0% комиссии):</span>
                <span>{calc.net} ₽</span>
              </div>
              <div style={{ color: '#555', marginTop: '4px', fontSize: '9px' }}>
                * При выводе на карту спишется 50 ₽ фиксированной комиссии банка.
              </div>
            </div>
          )}

          <button
            type="submit" disabled={loading}
            style={{
              padding: '14px',
              background: loading ? '#1a1a1a' : '#fff',
              color: loading ? '#555' : '#000',
              border: 'none', borderRadius: '4px',
              fontSize: '12px', fontWeight: 'bold',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'monospace', letterSpacing: '0.5px',
            }}
          >
            {loading ? 'ПУБЛИКАЦИЯ...' : '🚀 ЗАПУСТИТЬ ЛОТ'}
          </button>
        </form>

        {status && (
          <div style={{ marginTop: '10px', fontSize: '10px', color: '#eccc68', textAlign: 'center', fontFamily: 'monospace' }}>
            {'> '}{status}
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: '#000', border: '1px solid #222', padding: '11px',
  color: '#fff', fontSize: '12px', fontFamily: 'monospace',
  borderRadius: '4px', width: '100%', boxSizing: 'border-box',
};