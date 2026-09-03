import { FormEvent, useEffect, useState } from 'react';
import { adminApi, AdminApiError } from '../api/client';
import { ruRole } from '../i18n';

type StaffRow = {
  id: string;
  email: string;
  role: string;
  telegramId: string | null;
  createdAt: string;
  lastLoginAt: string | null;
};

type CreatedStaff = StaffRow & { password: string };

const ROLES = [
  { id: 'SUPPORT_ADMIN', label: 'Модератор / саппорт' },
  { id: 'SECURITY_ADMIN', label: 'Безопасность' },
  { id: 'FINANCE_ADMIN', label: 'Финансы' },
  { id: 'SUPER_ADMIN', label: 'Основатель (полный доступ)' },
];

export function StaffScreen({ clientIp, ipAllowlistConfigured }: { clientIp?: string | null; ipAllowlistConfigured?: boolean }) {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('SUPPORT_ADMIN');
  const [telegramId, setTelegramId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<CreatedStaff | null>(null);

  async function load() {
    const data = await adminApi<{ staff: StaffRow[] }>('/api/admin/staff');
    setStaff(data.staff);
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof AdminApiError ? err.message : 'Не удалось загрузить'));
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await adminApi<CreatedStaff>('/api/admin/staff', {
        method: 'POST',
        body: JSON.stringify({
          email,
          role,
          password: password.trim() || undefined,
          telegramId: telegramId.trim() || undefined,
        }),
      });
      setIssued(created);
      setEmail('');
      setPassword('');
      setTelegramId('');
      await load();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Не удалось создать');
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(id: string) {
    if (!confirm('Сгенерировать новый пароль? Старые сессии этой учётки сбросятся.')) return;
    setBusy(true);
    try {
      const updated = await adminApi<CreatedStaff>(`/api/admin/staff/${id}/password`, { method: 'POST', body: JSON.stringify({}) });
      setIssued(updated);
      await load();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Не удалось сбросить пароль');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Удалить админ-учётку?')) return;
    setBusy(true);
    try {
      await adminApi(`/api/admin/staff/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Не удалось удалить');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="panel">
        <h2>Ваш адрес для доступа</h2>
        <p className="muted">
          Это ваш текущий публичный адрес при входе в админку. Добавьте его в список разрешённых адресов в панели хостинга (несколько через запятую), затем перезапустите сервис.
          Без списка админка открыта с любого адреса.
        </p>
        <p>
          <strong>{clientIp ?? 'не определён'}</strong>
          {clientIp ? (
            <button
              type="button"
              className="ghost"
              style={{ marginLeft: 8 }}
              onClick={() => void navigator.clipboard.writeText(clientIp)}
            >
              Копировать
            </button>
          ) : null}
        </p>
        <p className="muted">{ipAllowlistConfigured ? 'Список адресов задан.' : 'Список адресов сейчас пустой.'}</p>
      </div>

      <div className="panel">
        <h2>Выдать доступ модератору</h2>
        <p className="muted">Это отдельная почта и пароль для админ-панели, не вход в маркетплейс. Пароль покажите человеку один раз.</p>
        {issued && (
          <p className="flag">
            Готово: <strong>{issued.email}</strong> / роль {ruRole(issued.role)}. Пароль: <strong>{issued.password}</strong>
          </p>
        )}
        <form onSubmit={onCreate}>
          <div className="row">
            <label>Почта<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <label>Пароль (пусто = сгенерировать)<input type="text" value={password} onChange={(e) => setPassword(e.target.value)} minLength={12} placeholder="минимум 12 символов" /></label>
            <label>Роль
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {ROLES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label>Telegram ID для MFA (необязательно)<input value={telegramId} onChange={(e) => setTelegramId(e.target.value)} placeholder="123456789" /></label>
          </div>
          {error && <p className="error">{error}</p>}
          <button className="primary" type="submit" disabled={busy}>{busy ? '…' : 'Создать'}</button>
        </form>
      </div>

      <div className="panel">
        <h2>Админ-учётки</h2>
        {staff.map((row) => (
          <div key={row.id} className="flag">
            <strong>{row.email}</strong> — {ruRole(row.role)}
            <div className="muted">Последний вход: {row.lastLoginAt ?? 'ещё не входил'}</div>
            <div className="row" style={{ marginTop: 8 }}>
              <button type="button" className="primary" disabled={busy} onClick={() => void resetPassword(row.id)}>Новый пароль</button>
              <button type="button" className="danger" disabled={busy} onClick={() => void remove(row.id)}>Удалить</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
