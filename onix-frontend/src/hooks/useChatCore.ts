import { useState, useEffect, useRef, useCallback } from 'react';

export interface IMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
  isAdmin: boolean;
}

const getInitData = () => {
  try { return (window as any).Telegram?.WebApp?.initData || ''; } catch { return ''; }
};

export function useChatCore(tgId: string) {
  const [messages, setMessages]       = useState<IMessage[]>([]);
  const [inputText, setInputText]     = useState('');
  const [loading, setLoading]         = useState(true);
  const chatEndRef                    = useRef<HTMLDivElement | null>(null);

  const fetchMessages = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch('/api/chat/history?limit=50', {
        signal,
        headers: { 'x-telegram-init-data': getInitData() },
      });
      if (!res.ok) return;
      const result = await res.json();
      if (result.success) setMessages(result.data);
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') console.error('[CHAT FETCH]', err);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    fetchMessages(controller.signal).finally(() => {
      if (mounted) setLoading(false);
    });

    // Long polling 2 сек
    const interval = setInterval(() => {
      if (mounted) fetchMessages().catch(console.error);
    }, 2000);

    return () => {
      mounted = false;
      clearInterval(interval);
      controller.abort();
    };
  }, [fetchMessages]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = inputText.trim();
    if (!text || !tgId) return;

    const tempId = `tmp_${Date.now()}`;
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Оптимистичное добавление
    setMessages(prev => [...prev, {
      id: tempId, senderId: tgId, senderName: 'ВЫ',
      text, timestamp: now, isAdmin: false,
    }]);
    setInputText('');

    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-init-data': getInitData(),
        },
        body: JSON.stringify({ senderTgId: tgId, text }),
      });
      if (!res.ok) throw new Error();
      await fetchMessages(); // обновляем с сервера
    } catch {
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setInputText(text);
      alert('Ошибка отправки сообщения.');
    }
  }, [inputText, tgId, fetchMessages]);

  return { messages, inputText, setInputText, chatEndRef, loading, sendMessage };
}