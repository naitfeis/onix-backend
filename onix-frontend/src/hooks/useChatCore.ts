import { useState, useEffect, useRef, useCallback } from 'react';

export interface IMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
  isAdmin: boolean;
}

export function useChatCore() {
  const [messages, setMessages] = useState<IMessage[]>([]);
  const [inputText, setInputText] = useState<string>("");
  const [activePartner, setActivePartner] = useState<string>("Глобальный хаб");
  const [userId, setUserId] = useState<string>("1");
  const [loading, setLoading] = useState<boolean>(true);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // ФУНКЦИЯ ВЫБОРКИ: Изолированный запрос свежих логов из PostgreSQL [проф. 1]
  const fetchMessagesFromServer = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/chat/history', { signal });
      if (response.ok) {
        const chatData = await response.json();
        setMessages(chatData.data);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('[🚨 FETCH CHAT ERROR]:', err);
      }
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const abortController = new AbortController();

    const initChat = async () => {
      try {
        let currentTgId = "1";
        const tgWebApp = (window as any).Telegram?.WebApp;
        if (tgWebApp?.initDataUnsafe?.user) {
          currentTgId = tgWebApp.initDataUnsafe.user.id.toString();
        }

        const profileRes = await fetch(`/api/users/profile?tgId=${currentTgId}`, { signal: abortController.signal });
        const profile = await profileRes.json();

        if (isMounted && profile.success) {
          setUserId(profile.data.id);
        }

        // Первая моментальная подгрузка истории базы [проф. 1]
        await fetchMessagesFromServer(abortController.signal);
      } catch (err) {
        console.error('[🚨 INITIAL CHAT LOAD ERROR]:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    initChat();

    // 🛰️ ULTRA-SENIOR LONG POLLING: Запускаем циклическую турбину авто-обновления чата! [проф. 1]
    // Каждые 1500 миллисекунд фронтенд бесшумно проверяет PostgreSQL на новые строки [проф. 1]
    const pollingInterval = setInterval(() => {
      if (isMounted) {
        fetchMessagesFromServer().catch(console.error);
      }
    }, 1500);

    const savedPartner = sessionStorage.getItem('active_chat_partner');
    if (savedPartner && isMounted) {
      setActivePartner(savedPartner);
      sessionStorage.removeItem('active_chat_partner');
    }

    const handleTabSwitch = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.tab === 'chat' && isMounted) {
        setActivePartner(customEvent.detail.partner || "Глобальный хаб");
      }
    };

    window.addEventListener('onix.switch_tab', handleTabSwitch);

    return () => {
      isMounted = false;
      clearInterval(pollingInterval); // Намертво гасим интервал при уходе с экрана [проф. 1]
      abortController.abort();
      window.removeEventListener('onix.switch_tab', handleTabSwitch);
    };
  }, [fetchMessagesFromServer]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const cachedText = inputText;
    const clientUuid = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const temporaryMessage: IMessage = {
      id: clientUuid,
      senderId: userId,
      senderName: "ВЫ",
      text: cachedText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isAdmin: false
    };

    setMessages(prev => [...prev, temporaryMessage]);
    setInputText("");

    try {
      const response = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderId: userId,
          text: cachedText,
          receiverName: activePartner === "Глобальный хаб" ? null : activePartner,
          idempotencyKey: clientUuid
        }),
      });

      if (!response.ok) throw new Error();
      const result = await response.json();
      if (!result.success) throw new Error();

      // Моментально обновляем историю с сервера после отправки своего сообщения [проф. 1]
      await fetchMessagesFromServer();

    } catch (err) {
      setMessages(prev => prev.filter(m => m.id !== clientUuid));
      setInputText(cachedText);
      alert("❌ Ошибка доставки: Сообщение не сохранено в PostgreSQL.");
    }
  }, [userId, inputText, activePartner, fetchMessagesFromServer]);

  return {
    messages, inputText, setInputText, activePartner, setActivePartner, chatEndRef, loading, handleSendMessage
  };
}