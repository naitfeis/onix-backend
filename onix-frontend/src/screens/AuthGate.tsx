import { useEffect, useRef, useState } from 'react';
import { loginWithTelegram as legacyLoginWithTelegram, ApiError } from '../api/client';
import {
  getWebsiteAuthProvider,
  getWebsiteLoginProvider,
  isWebsiteAuthV2,
  openTelegramBotLogin,
  startBotLogin,
  waitAndCompleteBotLogin,
  AuthV2ApiError,
} from '../auth';
import { BotLoginError } from '../auth/botLogin';
import { formatBanRemaining, refreshBanInfo, type BanInfo } from '../api/contracts';
import { Button } from '../design-system';

type TelegramLoginPayload = Record<string, string | number>;

declare global {
  interface Window {
    onixTelegramAuth?: (user: TelegramLoginPayload) => Promise<void>;
    Telegram?: Record<string, unknown>;
    TelegramLoginWidget?: unknown;
  }
}

let reportTelegramLoginError: (message: string) => void = () => {};
let reportTelegramBan: (ban: BanInfo) => void = () => {};

function extractBanFromError(error: unknown): BanInfo | undefined {
  if (error instanceof AuthV2ApiError || error instanceof BotLoginError) {
    const ban = (error.details as { ban?: BanInfo } | undefined)?.ban;
    if (error.code === 'AUTH_ACCOUNT_LOCKED' && ban) return ban;
  }
  if (error instanceof ApiError) {
    const details = error.details as { ban?: BanInfo } | undefined;
    const ban = details?.ban;
    if (error.code === 'AUTH_ACCOUNT_LOCKED' && ban) return ban;
  }
  return undefined;
}

function registerOnixTelegramAuth() {
  if (window.onixTelegramAuth) return;
  window.onixTelegramAuth = async (user: TelegramLoginPayload) => {
    try {
      if (isWebsiteAuthV2()) {
        await getWebsiteAuthProvider().loginWithTelegram(user);
      } else {
        await legacyLoginWithTelegram(user);
      }
      location.reload();
    } catch (error) {
      const ban = extractBanFromError(error);
      if (ban) reportTelegramBan(ban);
      reportTelegramLoginError('Telegram вход не выполнен.');
    }
  };
}

export function AuthNotice({
  miniApp,
  message,
  ban,
  onAuthenticated,
  onBan,
}: {
  miniApp: boolean;
  message?: string;
  ban?: BanInfo;
  onAuthenticated: () => void;
  onBan?: (ban: BanInfo) => void;
}) {
  const live = ban ? refreshBanInfo(ban) : undefined;
  const title = live
    ? 'Аккаунт заблокирован'
    : miniApp ? 'Не удалось подтвердить Telegram' : 'Войдите через Telegram';
  const expired = Boolean(live && !live.permanent && (live.remainingMs ?? 0) <= 0);
  return <div className="auth-notice" role="alert"><div>
    <strong>{title}</strong>
    {live ? <>
      <span className="ban-notice__row">Причина: {live.reason}</span>
      {live.comment ? <span className="ban-notice__row">Комментарий: {live.comment}</span> : null}
      {live.permanent
        ? <span className="ban-notice__row">Постоянная блокировка.</span>
        : <>
          <span className="ban-notice__row">
            Дата окончания: {live.bannedUntil
              ? new Date(live.bannedUntil).toLocaleString('ru-RU')
              : '—'}
          </span>
          <span className="ban-notice__row">{formatBanRemaining(live)}</span>
        </>}
      {expired && <span className="ban-notice__row">Повторите вход — блокировка будет снята автоматически.</span>}
    </> : <span>{message || 'Авторизация нужна для сделок и сообщений.'}</span>}
  </div>
    {miniApp ? <Button variant="secondary" onClick={() => location.reload()}>Повторить</Button> :
      <WebsiteLoginEntry onAuthenticated={onAuthenticated} onBan={onBan} />}
  </div>;
}

function WebsiteLoginEntry({ onAuthenticated, onBan }: { onAuthenticated: () => void; onBan?: (ban: BanInfo) => void }) {
  const provider = getWebsiteLoginProvider();
  if (provider === 'widget') return <TelegramLogin onBan={onBan} />;
  return <BotTelegramLogin onAuthenticated={onAuthenticated} onBan={onBan} />;
}

function BotTelegramLogin({ onAuthenticated, onBan }: { onAuthenticated: () => void; onBan?: (ban: BanInfo) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const onAuthenticatedRef = useRef(onAuthenticated);
  onAuthenticatedRef.current = onAuthenticated;

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  const onLogin = async () => {
    setError('');
    setBusy(true);
    setHint('Откройте Telegram и подтвердите вход…');
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const started = await startBotLogin(controller.signal);
      openTelegramBotLogin(started.deepLink, started.webDeepLink);
      await waitAndCompleteBotLogin(started.challengeId, { signal: controller.signal });
      setHint('');
      onAuthenticatedRef.current();
    } catch (e) {
      if (controller.signal.aborted) return;
      const ban = extractBanFromError(e);
      if (ban) onBan?.(ban);
      setError(e instanceof Error ? e.message : 'Не удалось войти через Telegram.');
      setHint('Оставайтесь на этой вкладке — после подтверждения в Telegram вход завершится сам.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  return <div>
    <Button onClick={() => void onLogin()} disabled={busy}>
      {busy ? 'Ожидание Telegram…' : 'Войти через Telegram'}
    </Button>
    {hint && <small>{hint}</small>}
    {error && <small>{error}</small>}
  </div>;
}

function TelegramLogin({ onBan }: { onBan?: (ban: BanInfo) => void }) {
  const bot = import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined;
  const [error, setError] = useState('');
  const [ban, setBan] = useState<BanInfo | undefined>();
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!bot) return;
    const host = hostRef.current;
    if (!host) return;
    reportTelegramLoginError = setError;
    reportTelegramBan = (next) => { setBan(next); onBan?.(next); };
    registerOnixTelegramAuth();

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', bot.replace(/^@/, ''));
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-userpic', 'false');
    script.setAttribute('data-onauth', 'onixTelegramAuth(user)');
    const handleError = () => setError('Telegram Login Widget не загрузился.');
    script.addEventListener('error', handleError);
    host.appendChild(script);

    return () => {
      reportTelegramLoginError = () => {};
      reportTelegramBan = () => {};
      script.removeEventListener('error', handleError);
      script.remove();
      host.replaceChildren();
    };
  }, [bot, onBan]);
  if (!bot) return <span>Настройте VITE_TELEGRAM_BOT_USERNAME</span>;
  return <div><div ref={hostRef} />{ban && <small>{formatBanRemaining(ban)}</small>}{error && <small>{error}</small>}</div>;
}
export default AuthNotice;
