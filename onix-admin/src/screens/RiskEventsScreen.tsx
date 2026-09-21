import { useEffect, useState } from 'react';
import { adminApi, AdminApiError } from '../api/client';
import { ruRiskAction, ruRiskLevel, ruRiskType } from '../i18n';
import { RiskEvidence } from './RiskEvidence';

type RiskEvent = {
  id: string;
  type: string;
  severity: number;
  level: string;
  status: string;
  createdAt: string;
  country?: string | null;
  ipAddress?: string | null;
  reasons: string[];
  action: string;
  payload: Record<string, unknown>;
  user: {
    id: string;
    onixId: string;
    username?: string | null;
    caseId?: string | null;
    locked: boolean;
    lockLevel?: string | null;
  } | null;
};

type Center = {
  counts: { critical: number; high: number; medium: number; low: number };
  events: RiskEvent[];
};

type Analytics = {
  windowHours: number;
  eventDenominator: number;
  scoreDenominator: number;
  scoreBuckets: Array<{ label: string; count: number }>;
  factorCounts: Record<string, number>;
  wouldLock: { count: number; byLevel: Record<string, number> };
  reviewOutcomes: Record<string, number>;
  falsePositiveProxy: {
    label: 'falsePositiveProxy';
    numerator: number;
    denominator: number;
    rate: number | null;
    definition: string;
  };
};

export function RiskEventsScreen({ onOpenUser }: { onOpenUser?: (onixId: string) => void }) {
  const [data, setData] = useState<Center | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [windowHours, setWindowHours] = useState(168);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    void adminApi<Center>('/api/admin/risk/center')
      .then(setData)
      .catch((err) => setError(err instanceof AdminApiError ? err.message : 'Не удалось загрузить риски'));
  }, []);

  useEffect(() => {
    void adminApi<Analytics>(`/api/admin/risk/analytics?windowHours=${windowHours}`)
      .then(setAnalytics)
      .catch((err) => setError(err instanceof AdminApiError ? err.message : 'Не удалось загрузить аналитику риска'));
  }, [windowHours]);

  const selected = data?.events.find((e) => e.id === openId) ?? null;
  const proxy = analytics?.falsePositiveProxy;

  return (
    <div className="panel">
      <h2>Центр риска</h2>
      <div className="grid">
        <div className="stat"><span>Критический</span><strong>{data?.counts.critical ?? '—'}</strong></div>
        <div className="stat"><span>Высокий</span><strong>{data?.counts.high ?? '—'}</strong></div>
        <div className="stat"><span>Средний</span><strong>{data?.counts.medium ?? '—'}</strong></div>
        <div className="stat"><span>Низкий</span><strong>{data?.counts.low ?? '—'}</strong></div>
      </div>
      <div className="admin-actions">
        <div className="row">
          <h3>Калибровка Risk Engine</h3>
          <label>
            Окно
            <select value={windowHours} onChange={(event) => setWindowHours(Number(event.target.value))}>
              <option value={24}>24 часа</option>
              <option value={168}>7 дней</option>
              <option value={720}>30 дней</option>
            </select>
          </label>
        </div>
        <div className="grid">
          <div className="stat"><span>События (denominator)</span><strong>{analytics?.eventDenominator ?? '—'}</strong></div>
          <div className="stat"><span>Оценки (denominator)</span><strong>{analytics?.scoreDenominator ?? '—'}</strong></div>
          <div className="stat"><span>Shadow would-lock</span><strong>{analytics?.wouldLock.count ?? '—'}</strong></div>
          <div className="stat">
            <span>falsePositiveProxy</span>
            <strong>{proxy?.rate == null ? '—' : `${(proxy.rate * 100).toFixed(1)}%`}</strong>
            <small className="muted">{proxy ? `${proxy.numerator}/${proxy.denominator}; не фактический FPR` : ''}</small>
          </div>
        </div>
        <p className="muted">
          Баллы: {(analytics?.scoreBuckets ?? []).map((bucket) => `${bucket.label}: ${bucket.count}`).join(' · ') || '—'}
        </p>
        <p className="muted">
          Факторы: {Object.entries(analytics?.factorCounts ?? {})
            .sort((a, b) => b[1] - a[1])
            .map(([factor, count]) => `${factor}: ${count}`)
            .join(' · ') || '—'}
        </p>
        <p className="muted">
          Решения: {Object.entries(analytics?.reviewOutcomes ?? {})
            .map(([outcome, count]) => `${outcome}: ${count}`)
            .join(' · ') || '—'}
        </p>
      </div>
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Пользователь</th>
            <th>Уровень</th>
            <th>Событие</th>
            <th>Что сделали</th>
            <th>Когда</th>
          </tr>
        </thead>
        <tbody>
          {(data?.events ?? []).map((e) => (
            <tr key={e.id} className="click-row" tabIndex={0} role="button" onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') setOpenId(e.id); }} onClick={() => setOpenId(e.id)}>
              <td>{e.user?.onixId || '—'}</td>
              <td>{ruRiskLevel(e.level)} ({e.severity})</td>
              <td>{ruRiskType(e.type)}</td>
              <td>{e.action ? ruRiskAction(e.action) : '—'}</td>
              <td>{new Date(e.createdAt).toLocaleString('ru-RU')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {selected && (
        <div className="admin-modal" onClick={() => setOpenId(null)}>
          <div className="admin-modal__panel" onClick={(ev) => ev.stopPropagation()}>
            <h2>
              {onOpenUser && selected.user?.onixId ? (
                <button className="link-button" type="button" onClick={() => onOpenUser(selected.user!.onixId)}>{selected.user.onixId}</button>
              ) : (selected.user?.onixId || 'Пользователь')}
            </h2>
            <p>
              {ruRiskLevel(selected.level)} · {ruRiskType(selected.type)}
              {selected.action ? ` · ${ruRiskAction(selected.action)}` : ''}
            </p>
            {selected.user?.caseId && <p>Дело: {selected.user.caseId}</p>}
            <h3>Доказательства риска</h3>
            <RiskEvidence payload={selected.payload} onOpenUser={onOpenUser} />
            <h3>Связи</h3>
            <ul className="muted">
              <li>Пользователь: {selected.user?.onixId || '—'}</li>
              <li>Дело: {selected.user?.caseId || '—'}</li>
              <li>Блокировка: {selected.user?.locked ? 'да' : 'нет'}</li>
              <li>Адрес: {selected.ipAddress || '—'}</li>
            </ul>
            <button className="ghost" type="button" onClick={() => setOpenId(null)}>Закрыть</button>
          </div>
        </div>
      )}
    </div>
  );
}
