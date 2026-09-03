import { FormEvent, useEffect, useState } from 'react';
import { adminApi, AdminApiError } from '../api/client';

type Message = {
  id: string; chatId: string; senderId: string | null; kind: string; text: string;
  deletedAt: string | null; deletedReason?: string | null; createdAt: string;
};

export function MessagesScreen({ onOpenChat }: { onOpenChat: (chatId: string) => void }) {
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    try {
      const result = await adminApi<{ messages: Message[] }>(
        `/api/admin/messages?limit=200${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}`,
      );
      setMessages(result.messages);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Не удалось загрузить сообщения');
    }
  }

  useEffect(() => { void load(); }, []);

  async function remove(id: string) {
    try {
      await adminApi(`/api/admin/messages/${id}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
      await load();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Не удалось удалить сообщение');
    }
  }

  return (
    <div className="panel">
      <h2>Модерация сообщений и чатов</h2>
      <form className="row" onSubmit={load}>
        <label>Текст<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="фраза из чата" /></label>
        <label>Причина удаления<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <button className="primary" type="submit">Найти</button>
      </form>
      {error && <p className="error">{error}</p>}
      <table>
        <thead><tr><th>ID / чат</th><th>Отправитель</th><th>Сообщение</th><th>Когда</th><th>Действия</th></tr></thead>
        <tbody>
          {messages.map((message) => (
            <tr key={message.id}>
              <td>#{message.id}<br /><span className="muted">{message.chatId}</span></td>
              <td>{message.senderId ?? 'система'}</td>
              <td className="message-text">
                {message.deletedAt
                  ? <><s>{message.text}</s><br /><span className="muted">{message.deletedReason}</span></>
                  : message.text}
              </td>
              <td>{(() => {
                const d = new Date(message.createdAt);
                if (!Number.isFinite(d.getTime())) return message.createdAt;
                const p = (n: number) => String(n).padStart(2, '0');
                return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
              })()}</td>
              <td className="actions-cell">
                {!message.deletedAt && <button className="danger" type="button" onClick={() => void remove(message.id)}>Удалить</button>}
                <button className="ghost" type="button" onClick={() => onOpenChat(message.chatId)}>Чат</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
