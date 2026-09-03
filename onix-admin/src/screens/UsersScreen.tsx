import { FormEvent, useEffect, useState } from 'react';
import { adminApi, AdminApiError } from '../api/client';
import { humanFlag, ruLedgerType, ruOrderStatus, ruPlatformStatus, ruRiskType } from '../i18n';

type UserRow = {
  id: string;
  onixId: string;
  username?: string | null;
  banned: boolean;
  wiped: boolean;
  sellBanned: boolean;
  balanceCents: string;
  lastSeenAt: string;
  createdAt: string;
};

type Investigation = {
  profile: {
    id: string;
    onixId: string;
    username?: string | null;
    createdAt: string;
    accountAgeDays: number;
    trustScore?: number;
    trustLevel?: number;
    securityScore?: number;
    balanceCents: string;
    depositAvailableCents?: string;
    depositLockedCents?: string;
    platformStatus?: string;
    bannedAt?: string | null;
    bannedUntil?: string | null;
    sellBannedAt?: string | null;
    deletedAt?: string | null;
    wiped?: boolean;
    telegramId?: string | null;
  };
  pro: {
    active: boolean;
    plan: string | null;
    status: string | null;
    startsAt: string | null;
    endsAt: string | null;
  };
  flags: Array<Record<string, unknown>>;
  securityEvents: Array<{ id: string; type: string; severity?: string; createdAt: string }>;
  ledger: Array<{ id: string; type: string; amountCents: string; createdAt: string; fundKind?: string | null; saleKind?: string | null }>;
  sales: Array<{ id: string; status: string; totalAmountCents: string; payoutCents: string; createdAt: string; productId: string }>;
  purchases: Array<{ id: string; status: string; totalAmountCents: string; createdAt: string; product: { title: string }; seller: { onixId: string } }>;
  chats: Array<{ id: string; kind: string; title?: string | null; updatedAt: string; memberIds: string[]; lastMessage?: { text: string; createdAt: string } | null }>;
  identities?: Array<{
    provider: 'TELEGRAM' | 'GOOGLE';
    providerUserId: string;
    label: string | null;
    isMain: boolean;
    wouldWipe: boolean;
  }>;
};

function money(cents: string) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return cents;
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(n / 100);
}

export function UsersScreen({
  adminRole,
  onOpenChat,
  initialOnixId,
}: {
  adminRole: string;
  onOpenChat: (chatId: string) => void;
  initialOnixId?: string | null;
}) {
  const [query, setQuery] = useState(initialOnixId ?? '');
  const [list, setList] = useState<UserRow[]>([]);
  const [data, setData] = useState<Investigation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [reason, setReason] = useState('MISCONDUCT');
  const [comment, setComment] = useState('');
  const [days, setDays] = useState('');
  const [status, setStatus] = useState('USER');
  const [balance, setBalance] = useState('');
  const [proEndsAt, setProEndsAt] = useState('');
  const [wipeConfirm, setWipeConfirm] = useState('');

  async function loadList(q = '') {
    const result = await adminApi<{ users: UserRow[] }>(`/api/admin/users?limit=50${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`);
    setList(result.users);
  }

  useEffect(() => { void loadList().catch(() => undefined); }, []);
  useEffect(() => {
    if (!initialOnixId) return;
    setQuery(initialOnixId);
    void loadUser(initialOnixId);
  }, [initialOnixId]);

  async function loadUser(id: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await adminApi<Investigation>(`/api/admin/users/${encodeURIComponent(id)}`);
      setData(result);
      setStatus(result.profile.platformStatus || 'USER');
      setWipeConfirm('');
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Не удалось загрузить пользователя');
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await loadList(query);
      if (/^(?:ONIX-)?\d+$/i.test(query.trim())) await loadUser(query.trim());
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Не удалось найти');
    } finally {
      setBusy(false);
    }
  }

  async function action(path: string, init: RequestInit) {
    if (!data) return;
    setActionBusy(true); setError(null);
    try {
      await adminApi(path, init);
      await loadUser(data.profile.onixId);
      await loadList(query);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Не удалось выполнить');
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>Пользователи · баны · удаление</h2>
      <form className="row" onSubmit={onSubmit}>
        <label>ONIX ID, ник или id
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ONIX-10 / Ара / 7" />
        </label>
        <button className="primary" type="submit" disabled={busy}>{busy ? '…' : 'Найти'}</button>
      </form>
      {error && <p className="error">{error}</p>}
      <table>
        <thead><tr><th>ONIX</th><th>Имя</th><th>Статус</th><th>Баланс</th><th>Был</th></tr></thead>
        <tbody>
          {list.map((row) => (
            <tr key={row.id}>
              <td>
                <button className="link-button" type="button" onClick={() => void loadUser(row.onixId)}>{row.onixId}</button>
              </td>
              <td>{row.username || '—'}</td>
              <td>{row.wiped ? 'стёрт' : row.banned ? 'бан' : row.sellBanned ? 'бан продаж' : 'ок'}</td>
              <td>{money(row.balanceCents)}</td>
              <td>{new Date(row.lastSeenAt).toLocaleString('ru-RU')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data && (
        <>
          <p>
            <strong>{data.profile.onixId}</strong>
            {' · '}
            {data.profile.username || '—'}
            {' · '}
            аккаунту {data.profile.accountAgeDays} дн.
            {' · '}
            {data.profile.wiped ? 'СТЁРТ' : data.profile.deletedAt ? 'БАН' : ruPlatformStatus(data.profile.platformStatus || 'active')}
          </p>
          <p className="muted">
            Баланс {money(data.profile.balanceCents)}
            {' · залог '}
            {money(data.profile.depositAvailableCents ?? '0')}
            {' / заморозка '}
            {money(data.profile.depositLockedCents ?? '0')}
            {' · trust L'}{data.profile.trustLevel ?? '—'}
            {data.profile.telegramId ? ` · tg ${data.profile.telegramId}` : ' · Telegram не привязан'}
          </p>
          <div className="admin-actions">
            <h3>Модерация</h3>
            <div className="row">
              <label>Причина бана
                <select value={reason} onChange={(e) => setReason(e.target.value)}>
                  <option value="MISCONDUCT">Неадекват</option>
                  <option value="THIRD_PARTY_ADS">Чужая реклама</option>
                  <option value="OFF_PLATFORM_DEAL">Сделка вне ONIX</option>
                  <option value="FRAUD">Мошенничество</option>
                  <option value="SELLER_NO_RESPONSE">Продавец не отвечает</option>
                  <option value="SALE_PAYOUT">Выплата за продажу от 100 ₽</option>
                  <option value="OTHER">Другое</option>
                </select>
              </label>
              <label>Срок, дни<input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" /></label>
            </div>
            <label>Публичный комментарий<textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} required /></label>
            <div className="row">
              <button className="danger" type="button" disabled={actionBusy || data.profile.wiped} onClick={() => void action(`/api/admin/users/${encodeURIComponent(data.profile.onixId)}/ban`, { method: 'PATCH', body: JSON.stringify({ reason, comment, ...(days ? { durationDays: Number(days) } : {}) }) })}>Забанить</button>
              <button className="ghost" type="button" disabled={actionBusy || !data.profile.deletedAt || data.profile.wiped} onClick={() => void action(`/api/admin/users/${encodeURIComponent(data.profile.onixId)}/unban`, { method: 'PATCH', body: JSON.stringify({ comment }) })}>Снять бан</button>
              <button className="ghost" type="button" disabled={actionBusy} onClick={() => void action(`/api/admin/users/${encodeURIComponent(data.profile.onixId)}/sell-ban`, { method: 'PATCH', body: JSON.stringify({ banned: !data.profile.sellBannedAt, comment }) })}>{data.profile.sellBannedAt ? 'Разрешить продажи' : 'Бан продаж'}</button>
            </div>
            <div className="row">
              {adminRole === 'SUPER_ADMIN' && (
                <>
                  <label>Статус
                    <select value={status} onChange={(e) => setStatus(e.target.value)}>
                      <option value="USER">Пользователь</option>
                      <option value="VERIFIED_SELLER">Проверенный продавец</option>
                      <option value="MODERATOR">Модератор</option>
                      <option value="ADMIN">Администратор</option>
                      <option value="SUPER_ADMIN">Основатель</option>
                      <option value="VIP">VIP</option>
                    </select>
                  </label>
                  <button className="primary" type="button" disabled={actionBusy || status === data.profile.platformStatus} onClick={() => void action(`/api/admin/users/${encodeURIComponent(data.profile.onixId)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })}>Сменить статус</button>
                </>
              )}
              <label>Корректировка баланса (в копейках)<input value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="1000 или -1000" /></label>
              <button className="primary" type="button" disabled={actionBusy || !balance} onClick={() => void action(`/api/admin/users/${encodeURIComponent(data.profile.onixId)}/balance`, { method: 'POST', body: JSON.stringify({ amountCents: balance, reason: comment, idempotencyKey: `admin-${Date.now()}-${Math.random().toString(36).slice(2)}` }) })}>Списать/начислить</button>
            </div>
          </div>
          <div className="admin-actions">
            <h3>Привязки входа</h3>
            <p className="muted">
              Telegram — основная, если она есть. Google тогда дополнительная: её можно снять, аккаунт останется.
              Снятие основной привязки стирает аккаунт (томбстоун, леджер остаётся).
            </p>
            {(data.identities ?? []).length === 0 ? (
              <p className="muted">Привязок нет.</p>
            ) : (
              <table>
                <thead><tr><th>Провайдер</th><th>Кто</th><th>Роль</th><th></th></tr></thead>
                <tbody>
                  {(data.identities ?? []).map((ident) => (
                    <tr key={`${ident.provider}:${ident.providerUserId}`}>
                      <td>{ident.provider}</td>
                      <td>{ident.label || ident.providerUserId}</td>
                      <td>{ident.isMain ? 'основная' : 'дополнительная'}</td>
                      <td>
                        <button
                          className={ident.wouldWipe ? 'danger' : 'ghost'}
                          type="button"
                          disabled={actionBusy || data.profile.wiped || (ident.wouldWipe && adminRole !== 'SUPER_ADMIN')}
                          onClick={() => {
                            if (ident.wouldWipe) {
                              const ok = window.confirm(
                                `${ident.provider} — основная привязка.\n\nАккаунт ${data.profile.onixId} будет стёрт: вход закроется, профиль очистится, проводки останутся.\n\nПродолжить?`,
                              );
                              if (!ok) return;
                            } else if (!window.confirm(`Отвязать ${ident.provider} от ${data.profile.onixId}? Аккаунт останется.`)) {
                              return;
                            }
                            void action(`/api/admin/users/${encodeURIComponent(data.profile.onixId)}/identities/unlink`, {
                              method: 'POST',
                              body: JSON.stringify({
                                provider: ident.provider,
                                confirmOnixId: ident.wouldWipe ? data.profile.onixId : undefined,
                                reason: comment || (ident.wouldWipe
                                  ? `Отвязка основной привязки ${ident.provider}`
                                  : `Отвязка ${ident.provider}`),
                              }),
                            });
                          }}
                        >
                          {ident.wouldWipe ? 'Отвязать и стереть' : 'Отвязать'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {adminRole === 'SUPER_ADMIN' && (
            <div className="admin-actions">
              <h3>Стереть аккаунт</h3>
              <p className="muted">
                Здесь профиль становится томбстоуном: проводки остаются, войти нельзя.
                Telegram/Google отвязываются, вход закрыт, лоты снимаются, <strong>леджер остаётся</strong>.
                Сначала закройте сделки и обнулите баланс/залог.
              </p>
              <div className="row">
                <label>Подтвердите ONIX ID
                  <input value={wipeConfirm} onChange={(e) => setWipeConfirm(e.target.value)} placeholder={data.profile.onixId} />
                </label>
                <button
                  className="danger"
                  type="button"
                  disabled={actionBusy || data.profile.wiped || wipeConfirm.trim() === ''}
                  onClick={() => void action(`/api/admin/users/${encodeURIComponent(data.profile.onixId)}`, {
                    method: 'DELETE',
                    body: JSON.stringify({ confirmOnixId: wipeConfirm.trim(), reason: comment || 'Admin wipe' }),
                  })}
                >
                  Стереть пользователя
                </button>
              </div>
            </div>
          )}
          {adminRole === 'SUPER_ADMIN' && (
            <div className="admin-actions">
              <h3>PRO</h3>
              <p className="muted">
                {data.pro.active ? `Активен${data.pro.endsAt ? ` до ${new Date(data.pro.endsAt).toLocaleString('ru-RU')}` : ''}` : 'Не активен'}
              </p>
              <div className="row">
                <label>Дата окончания
                  <input type="datetime-local" value={proEndsAt} onChange={(event) => setProEndsAt(event.target.value)} />
                </label>
                <button
                  className="primary"
                  type="button"
                  disabled={actionBusy}
                  onClick={() => void action(`/api/admin/users/${encodeURIComponent(data.profile.onixId)}/pro/grant`, {
                    method: 'POST',
                    body: JSON.stringify(proEndsAt ? { endsAt: new Date(proEndsAt).toISOString() } : {}),
                  })}
                >
                  Выдать PRO
                </button>
                <button
                  className="ghost"
                  type="button"
                  disabled={actionBusy || !data.pro.active}
                  onClick={() => void action(`/api/admin/users/${encodeURIComponent(data.profile.onixId)}/pro/revoke`, { method: 'POST' })}
                >
                  Снять PRO
                </button>
              </div>
            </div>
          )}
          <h3>Покупки</h3>
          <table><thead><tr><th>ID</th><th>Товар</th><th>Продавец</th><th>Статус</th><th>Сумма</th></tr></thead>
            <tbody>{data.purchases.map((o) => <tr key={o.id}><td>#{o.id}</td><td>{o.product.title}</td><td>{o.seller.onixId}</td><td>{ruOrderStatus(o.status)}</td><td>{money(o.totalAmountCents)}</td></tr>)}</tbody>
          </table>
          <h3>Продажи</h3>
          <table><thead><tr><th>ID</th><th>Товар</th><th>Статус</th><th>Итого</th><th>Выплата</th></tr></thead>
            <tbody>{data.sales.map((o) => <tr key={o.id}><td>#{o.id}</td><td>{o.productId}</td><td>{ruOrderStatus(o.status)}</td><td>{money(o.totalAmountCents)}</td><td>{money(o.payoutCents)}</td></tr>)}</tbody>
          </table>
          <h3>Чаты</h3>
          <table><thead><tr><th>Чат</th><th>Последнее</th><th>Обновлён</th></tr></thead>
            <tbody>{data.chats.map((c) => <tr key={c.id}>
              <td>
                <button className="link-button" type="button" onClick={() => onOpenChat(c.id)}>{c.title || c.kind}</button>
                <br /><span className="muted">{c.id}</span>
              </td>
              <td>{c.lastMessage?.text || '—'}</td>
              <td>{new Date(c.updatedAt).toLocaleString('ru-RU')}</td>
            </tr>)}</tbody>
          </table>
          <h3>Флаги</h3>
          {data.flags.length === 0 ? <p className="muted">Нет</p> : data.flags.map((f, i) => (
            <div key={i} className="flag">
              {humanFlag(f).map((line) => <div key={line}>{line}</div>)}
            </div>
          ))}
          <h3>События безопасности</h3>
          <table>
            <thead><tr><th>Тип</th><th>Уровень</th><th>Когда</th></tr></thead>
            <tbody>
              {data.securityEvents.map((e) => (
                <tr key={e.id}><td>{ruRiskType(e.type)}</td><td>{e.severity || '—'}</td><td>{new Date(e.createdAt).toLocaleString('ru-RU')}</td></tr>
              ))}
            </tbody>
          </table>
          <h3>Движение денег</h3>
          <table>
            <thead><tr><th>Тип</th><th>Сумма</th><th>Источник</th><th>Когда</th></tr></thead>
            <tbody>
              {data.ledger.map((w) => (
                <tr key={w.id}>
                  <td>{ruLedgerType(w.type)}</td>
                  <td>{money(w.amountCents)}</td>
                  <td>{[w.fundKind, w.saleKind].filter(Boolean).join('/') || '—'}</td>
                  <td>{new Date(w.createdAt).toLocaleString('ru-RU')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
