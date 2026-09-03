import { useEffect, useState } from 'react';
import { adminApi, AdminApiError } from '../api/client';
import { humanFlag } from '../i18n';

type Flag = {
  code?: string;
  onixId?: string;
  userId?: string;
  reason?: string;
  severity?: string;
  createdAt?: string;
  status?: string;
  restrictedAccountSaleCents?: string;
  protectionUntil?: string;
};

export function SecurityFlagsScreen() {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void adminApi<{ flags: Flag[] }>('/api/admin/security-flags')
      .then((data) => setFlags(data.flags ?? []))
      .catch((err) => setError(err instanceof AdminApiError ? err.message : 'Не удалось загрузить'));
  }, []);

  return (
    <div className="panel">
      <h2>Алерты</h2>
      <p className="muted">Защита новых аккаунтов после продажи аккаунта и связанные пометки.</p>
      {error && <p className="error">{error}</p>}
      {!error && flags.length === 0 && <p className="muted">Открытых пометок нет.</p>}
      {flags.map((f, i) => (
        <div key={`${f.onixId ?? f.userId ?? 'flag'}-${i}`} className="flag">
          <strong>{f.onixId || '—'}</strong>
          {humanFlag(f as Record<string, unknown>).map((line) => (
            <div className="muted" key={line}>{line}</div>
          ))}
          {f.createdAt ? <div className="muted">{new Date(f.createdAt).toLocaleString('ru-RU')}</div> : null}
        </div>
      ))}
    </div>
  );
}
