import { FormEvent, useEffect, useState } from 'react';
import { adminApi, AdminApiError } from '../api/client';

type ChatThread = {
  id: string;
  kind: string;
  title: string;
  updatedAt: string;
  members: Array<{ userId: string; onixId: string; username: string | null }>;
  messages: Array<{
    id: string;
    senderId: string | null;
    kind: string;
    text: string;
    deletedAt: string | null;
    deletedReason?: string | null;
    createdAt: string;
  }>;
};

function formatExactDateTime(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function ChatThreadModal({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const [data, setData] = useState<ChatThread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const load = () => {
    setError(null);
    return adminApi<ChatThread>(`/api/admin/chats/${encodeURIComponent(chatId)}`)
      .then(setData)
      .catch((err) => setError(err instanceof AdminApiError ? err.message : 'Не удалось открыть чат'));
  };

  useEffect(() => {
    setData(null);
    setReply('');
    void load();
  }, [chatId]);

  const nameById = new Map((data?.members ?? []).map((m) => [m.userId, `${m.username || m.onixId} (${m.onixId})`]));
  const canReply = data && data.kind !== 'AI';

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = reply.trim();
    if (!text || !canReply || sending) return;
    setSending(true);
    setError(null);
    try {
      await adminApi(`/api/admin/chats/${encodeURIComponent(chatId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      setReply('');
      await load();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Не удалось отправить');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="admin-modal" role="dialog" aria-modal="true" aria-label="Чат" onClick={onClose}>
      <div className="admin-modal__panel" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>{data?.title || 'Чат'}</h2>
            <p className="muted">{data?.kind === 'AI' ? 'Onix AI' : data?.kind === 'SUPPORT' ? 'Поддержка' : 'Чат'}</p>
          </div>
          <button className="ghost" type="button" onClick={onClose}>Закрыть</button>
        </div>
        {error && <p className="error">{error}</p>}
        {data && (
          <>
            <p className="muted">Участники: {data.members.map((m) => `${m.username || '—'} ${m.onixId}`).join(' · ') || '—'}</p>
            <p className="muted">Новые сообщения сверху. Время — локальное, с секундами.</p>
            <div className="chat-thread">
              {data.messages.length === 0 ? <p className="muted">Сообщений нет.</p> : data.messages.map((m) => (
                <div key={m.id} className={`chat-bubble${m.kind === 'SYSTEM' ? ' system' : ''}`}>
                  <small>{m.kind === 'SYSTEM' ? 'ONIX' : (nameById.get(m.senderId ?? '') || m.senderId || '—')} · {formatExactDateTime(m.createdAt)}</small>
                  <p>{m.deletedAt ? <s>{m.text}</s> : m.text}</p>
                  {m.deletedAt && m.deletedReason ? <span className="muted">{m.deletedReason}</span> : null}
                </div>
              ))}
            </div>
            {canReply ? (
              <form className="row" style={{ marginTop: 12, gap: 8 }} onSubmit={(e) => void onSubmit(e)}>
                <input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Ответ поддержки…"
                  maxLength={4000}
                  style={{ flex: 1 }}
                  disabled={sending}
                />
                <button type="submit" disabled={sending || !reply.trim()}>
                  {sending ? '…' : 'Отправить'}
                </button>
              </form>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
