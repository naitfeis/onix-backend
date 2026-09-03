import { useEffect, useState } from 'react';
import { adminApi, AdminApiError } from '../api/client';
import { humanPayload, ruRiskAction, ruRiskLevel, ruRiskReason, ruRiskType } from '../i18n';

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

export function RiskEventsScreen() {
  const [data, setData] = useState<Center | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    void adminApi<Center>('/api/admin/risk/center')
      .then(setData)
      .catch((err) => setError(err instanceof AdminApiError ? err.message : 'Не удалось загрузить риски'));
  }, []);

  const selected = data?.events.find((e) => e.id === openId) ?? null;
  const details = selected ? humanPayload(selected.payload) : [];

  return (
    <div className="panel">
      <h2>Центр риска</h2>
      <div className="grid">
        <div className="stat"><span>Критический</span><strong>{data?.counts.critical ?? '—'}</strong></div>
        <div className="stat"><span>Высокий</span><strong>{data?.counts.high ?? '—'}</strong></div>
        <div className="stat"><span>Средний</span><strong>{data?.counts.medium ?? '—'}</strong></div>
        <div className="stat"><span>Низкий</span><strong>{data?.counts.low ?? '—'}</strong></div>
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
            <tr key={e.id} className="click-row" onClick={() => setOpenId(e.id)}>
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
            <h2>{selected.user?.onixId || 'Пользователь'}</h2>
            <p>
              {ruRiskLevel(selected.level)} · {ruRiskType(selected.type)}
              {selected.action ? ` · ${ruRiskAction(selected.action)}` : ''}
            </p>
            {selected.user?.caseId && <p>Дело: {selected.user.caseId}</p>}
            <h3>Доказательства риска</h3>
            <ul>
              {(selected.reasons.length ? selected.reasons.map(ruRiskReason) : details.length ? details : ['Нет подробностей']).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            {details.length > 0 && selected.reasons.length > 0 && (
              <>
                <h3>Подробности</h3>
                <ul>{details.map((line) => <li key={line}>{line}</li>)}</ul>
              </>
            )}
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
