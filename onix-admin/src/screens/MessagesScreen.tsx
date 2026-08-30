import { FormEvent, useState } from 'react';
import { adminApi, AdminApiError } from '../api/client';

type Message = {
  id: string; chatId: string; senderId: string | null; kind: string; text: string;
  deletedAt: string | null; deletedReason?: string | null; createdAt: string;
};

export function MessagesScreen() {
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  async function load(e?: FormEvent) {
    e?.preventDefault(); setError(null);
    try {
      const result = await adminApi<{ messages: Message[] }>(`/api/admin/messages?limit=200${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}`);
      setMessages(result.messages);
    } catch (err) { setError(err instanceof AdminApiError ? err.message : 'Failed'); }
  }
  async function remove(id: string) {
    try {
      await adminApi(`/api/admin/messages/${id}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
      await load();
    } catch (err) { setError(err instanceof AdminApiError ? err.message : 'Action failed'); }
  }
  return <div className="panel">
    <h2>Global message moderation</h2>
    <form className="row" onSubmit={load}>
      <label>Search text<input value={search} onChange={(e) => setSearch(e.target.value)} /></label>
      <label>Deletion reason<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <button className="primary" type="submit">Search</button>
    </form>
    {error && <p className="error">{error}</p>}
    <table><thead><tr><th>ID / chat</th><th>Sender</th><th>Message</th><th>When</th><th>Action</th></tr></thead>
      <tbody>{messages.map((message) => <tr key={message.id}>
        <td>#{message.id}<br /><span className="muted">{message.chatId}</span></td><td>{message.senderId ?? 'system'}</td>
        <td className="message-text">{message.deletedAt ? <><s>{message.text}</s><br /><span className="muted">{message.deletedReason}</span></> : message.text}</td>
        <td>{new Date(message.createdAt).toLocaleString()}</td>
        <td>{!message.deletedAt && <button className="danger" type="button" onClick={() => void remove(message.id)}>Delete globally</button>}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
