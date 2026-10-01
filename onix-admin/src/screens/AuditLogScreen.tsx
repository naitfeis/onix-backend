import { useState } from 'react';
import { adminApi, AdminApiError } from '../api/client';
import { ruAuditAction, ruMetaKey, ruRole } from '../i18n';
import { EmptyRows } from '../components/EmptyRows';

type Log = {
  id: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadataJson?: unknown;
  createdAt: string;
  adminUser: { email: string; role: string };
};

function metaLines(value: unknown): string {
  if (!value || typeof value !== 'object') return '—';
  return Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${ruMetaKey(k)}: ${typeof v === 'object' ? 'есть данные' : String(v)}`)
    .join(' · ') || '—';
}

export function AuditLogScreen() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      setLogs((await adminApi<{ logs: Log[] }>('/api/admin/audit-log?limit=200')).logs);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : 'Не удалось загрузить журнал');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>Журнал действий</h2>
      <button className="primary" type="button" onClick={() => void load()} disabled={busy}>
        {busy ? 'Загрузка…' : 'Обновить'}
      </button>
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Сотрудник</th>
            <th>Действие</th>
            <th>Объект</th>
            <th>Подробности</th>
            <th>Когда</th>
          </tr>
        </thead>
        <tbody>
          {logs.length === 0 && <EmptyRows colSpan={5} label="Записей аудита нет." />}
          {logs.map((l) => (
            <tr key={l.id}>
              <td>
                {l.adminUser.email}
                <br />
                <span className="muted">{ruRole(l.adminUser.role)}</span>
              </td>
              <td>{ruAuditAction(l.action)}</td>
              <td>{l.targetType || '—'} {l.targetId || ''}</td>
              <td>{metaLines(l.metadataJson)}</td>
              <td>{new Date(l.createdAt).toLocaleString('ru-RU')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
