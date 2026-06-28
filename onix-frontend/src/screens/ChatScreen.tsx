import { useChatCore } from '../hooks/useChatCore';

interface Props { tgId: string }

export default function ChatScreen({ tgId }: Props) {
  const { messages, inputText, setInputText, chatEndRef, loading, sendMessage } = useChatCore(tgId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 160px)' }}>

      <div style={{ background: '#0b0b0b', border: '1px solid #161616', padding: '12px', borderRadius: '4px', marginBottom: '12px' }}>
        <div style={{ fontSize: '11px', color: '#fff', fontWeight: 'bold' }}>// 💬 ГЛОБАЛЬНЫЙ ЧАТ ONIX</div>
        <div style={{ fontSize: '9px', color: '#555', marginTop: '2px' }}>ЖИВОЙ ХАБ ТРЕЙДЕРОВ</div>
      </div>

      {/* Лента сообщений */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', paddingBottom: '8px' }}>
        {loading ? (
          <div style={{ color: '#444', textAlign: 'center', padding: '20px', fontSize: '11px' }}>ЗАГРУЗКА ИСТОРИИ...</div>
        ) : messages.length === 0 ? (
          <div style={{ color: '#333', textAlign: 'center', padding: '20px', fontSize: '11px' }}>Сообщений пока нет. Будь первым!</div>
        ) : (
          messages.map(msg => {
            const isMe = msg.senderId === tgId;
            return (
              <div
                key={msg.id}
                style={{
                  display: 'flex', flexDirection: 'column',
                  alignItems: isMe ? 'flex-end' : 'flex-start',
                }}
              >
                <div style={{ fontSize: '9px', color: msg.isAdmin ? '#ff9f43' : '#444', marginBottom: '2px' }}>
                  {msg.isAdmin ? '👑 ' : ''}{msg.senderName} • {msg.timestamp}
                </div>
                <div style={{
                  maxWidth: '80%', padding: '8px 12px', borderRadius: '4px',
                  background: isMe ? '#00d2d3' : '#0b0b0b',
                  color: isMe ? '#000' : '#fff',
                  border: `1px solid ${isMe ? '#00d2d3' : '#1c1c1c'}`,
                  fontSize: '12px', lineHeight: '1.4',
                  wordBreak: 'break-word',
                }}>
                  {msg.text}
                </div>
              </div>
            );
          })
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Форма отправки */}
      <form onSubmit={sendMessage} style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <input
          type="text" placeholder="Сообщение..."
          value={inputText} onChange={e => setInputText(e.target.value)}
          maxLength={1000}
          style={{
            flex: 1, background: '#000', border: '1px solid #222',
            padding: '10px', color: '#fff', fontSize: '12px',
            fontFamily: 'monospace', borderRadius: '4px',
          }}
        />
        <button
          type="submit" disabled={!inputText.trim()}
          style={{
            padding: '10px 16px', background: inputText.trim() ? '#00d2d3' : '#1a1a1a',
            color: inputText.trim() ? '#000' : '#555',
            border: 'none', borderRadius: '4px',
            fontSize: '12px', fontWeight: 'bold',
            cursor: inputText.trim() ? 'pointer' : 'not-allowed',
            fontFamily: 'monospace',
          }}
        >
          ➤
        </button>
      </form>
    </div>
  );
}