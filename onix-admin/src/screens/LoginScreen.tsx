import { FormEvent, useState } from 'react';
import { adminApi, AdminApiError } from '../api/client';

type Props = {
  onAuthed: (accessToken: string, me: { id: string; email: string; role: string }) => void;
};

type LoginResult =
  | { mfaRequired: true; challengeId: string; debugCode?: string }
  | { mfaRequired: false; accessToken: string; admin: { id: string; email: string; role: string } };

type MfaResult = { accessToken: string; admin: { id: string; email: string; role: string } };

export function LoginScreen({ onAuthed }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await adminApi<LoginResult>('/api/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (data.mfaRequired) {
        setChallengeId(data.challengeId);
        setDebugCode(data.debugCode ?? null);
        return;
      }
      onAuthed(data.accessToken, data.admin);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Не удалось войти');
    } finally {
      setBusy(false);
    }
  }

  async function onMfa(e: FormEvent) {
    e.preventDefault();
    if (!challengeId) return;
    setBusy(true);
    setError(null);
    try {
      const data = await adminApi<MfaResult>('/api/admin/auth/mfa', {
        method: 'POST',
        body: JSON.stringify({ challengeId, code }),
      });
      onAuthed(data.accessToken, data.admin);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Неверный код');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>Админ-панель ONIX</h1>
        <p className="muted">Отдельный вход для сотрудников. Сессия маркетплейса сюда не подходит.</p>
        {!challengeId ? (
          <form onSubmit={onLogin}>
            <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <label>Почта<input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
              <label>Пароль<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
            </div>
            {error && <p className="error">{error}</p>}
            <button className="primary" type="submit" disabled={busy}>{busy ? '…' : 'Войти'}</button>
          </form>
        ) : (
          <form onSubmit={onMfa}>
            <p className="muted">Код подтверждения из Telegram.</p>
            {debugCode && <p className="muted">Код: <strong>{debugCode}</strong></p>}
            <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <label>Код<input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" required /></label>
            </div>
            {error && <p className="error">{error}</p>}
            <button className="primary" type="submit" disabled={busy}>{busy ? '…' : 'Подтвердить'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
