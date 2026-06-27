import { memo } from 'react'; // Исправлено: Неиспользуемый React удален из импорта под ноль ошибок [проф. 1]
import { useChatCore } from '../hooks/useChatCore.ts';
import type { IMessage } from '../hooks/useChatCore.ts'; // Строгое соответствие флагу TS1484 [проф. 1]

// =====================================================================
// 🔮 СУБ-КОМПОНЕНТ СТРОКИ СООБЩЕНИЯ (МЕМОИЗАЦИЯ ДЛЯ 60 FPS И СКОРОСТИ) [проф. 1]
// =====================================================================
const ChatMessageRow = memo(({ msg }: { msg: IMessage }) => {
  return (
    <div
      style={{
        borderLeft: msg.isAdmin ? '2px solid #ff3333' : '2px solid #fff',
        paddingLeft: '10px',
        backgroundColor: msg.isAdmin ? '#110404' : 'transparent',
        padding: msg.isAdmin ? '8px' : '0 0 0 10px'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
        <span style={{ fontSize: '9px', color: msg.isAdmin ? '#ff3333' : '#555', fontWeight: 'bold', letterSpacing: '0.5px' }}>
          {msg.senderName.toUpperCase()} {msg.isAdmin && "// 🔮 CORE СОВЕТНИК"}
        </span>
        <span style={{ fontSize: '8px', color: '#333', fontFamily: 'monospace' }}>{msg.timestamp}</span>
      </div>
      <p style={{ margin: 0, fontSize: '12px', color: msg.isAdmin ? '#ff9999' : '#ccc', lineHeight: '1.4' }}>
        {msg.text}
      </p>
    </div>
  );
});

// Задаем имя для удобной отладки в React DevTools [проф. 1]
ChatMessageRow.displayName = 'ChatMessageRow';

// =====================================================================
// 👑 ГЛАВНЫЙ ЭКРАН ЧАТ-ХАБА (PRESENTATION LAYER) [проф. 1]
// =====================================================================
export default function ChatScreen() {
  const chat = useChatCore();

  if (chat.loading) {
    return (
      <div style={{ color: '#fff', textAlign: 'center', marginTop: '20px', fontFamily: 'monospace' }}>
        LOADING CHAT CORE...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)', position: 'relative' }}>

      {/* СТАТУС-БАР ТЕКУЩЕГО ДИАЛОГА */}
      <div style={{ background: '#0b0b0b', border: '1px solid #161616', padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ fontSize: '10px', color: '#b57cff', fontWeight: 'bold', letterSpacing: '1px' }}>
          // 🔮 LINKED TO: {chat.activePartner.toUpperCase()}
        </div>
        {chat.activePartner !== "Глобальный хаб" && (
          <button
            onClick={() => chat.setActivePartner("Глобальный хаб")}
            style={{ background: 'transparent', border: '1px solid #333', color: '#555', padding: '4px 8px', fontSize: '9px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            В ХАБ ✕
          </button>
        )}
      </div>

      {/* КОНТЕЙНЕР ДИНАМИЧЕСКИХ СООБЩЕНИЙ С СУБД POSTGRESQL */}
      <div style={{ flex: 1, border: '1px solid #161616', padding: '14px', backgroundColor: '#020202', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '12px' }}>
        {chat.messages.length === 0 ? (
          <div style={{ color: '#333', textAlign: 'center', fontSize: '11px', marginTop: '20px', fontFamily: 'monospace' }}>
            [ СИСТЕМА ОЧИЩЕНА // НЕТ АКТИВНЫХ ЛОГОВ ПЕРЕПИСКИ ]
          </div>
        ) : (
          chat.messages.map((msg: IMessage) => (
            <ChatMessageRow key={msg.id} msg={msg} />
          ))
        )}
        {/* Безопасная точка автоматического скролла */}
        <div ref={chat.chatEndRef} />
      </div>

      {/* ФОРМА ОТПРАВКИ ЖИВЫХ СООБЩЕНИЙ */}
      <form onSubmit={chat.handleSendMessage} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <input
          type="text"
          value={chat.inputText}
          onChange={(e) => chat.setInputText(e.target.value)}
          placeholder={chat.activePartner === "Глобальный хаб" ? "ВВЕДИТЕ СООБЩЕНИЕ В ГЛОБАЛЬНЫЙ ХАБ..." : `НАПИСАТЬ ТРЕЙДЕРУ ${chat.activePartner}...`}
          style={{ flex: 1, background: '#0b0b0b', border: '1px solid #161616', padding: '12px', color: '#fff', fontSize: '12px', fontFamily: 'monospace', borderRadius: 0 }}
        />
        <button
          type="submit"
          style={{ backgroundColor: '#fff', color: '#000', border: 'none', padding: '12px 20px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase' }}
        >
          ОТПРАВИТЬ
        </button>
      </form>

    </div>
  );
}