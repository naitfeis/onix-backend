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
  getAuthV2PublicConfig,
  startGoogleOAuth,
  postAuthV2Logout,
  getSharedAuthManager,
} from '../auth';
import { BotLoginError, confirmWebsiteLoginFromMiniAppIfNeeded } from '../auth/botLogin';
import { getTelegramStartParam } from '../auth/telegramEnv';
import { formatBanRemaining, refreshBanInfo, type BanInfo } from '../api/contracts';
import { Button } from '../design-system';
import { GoogleLogo, TelegramLogo } from '../components/BrandLogos';

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
  soft,
  onAuthenticated,
  onBan,
}: {
  miniApp: boolean;
  message?: string;
  ban?: BanInfo;
  /** Guest chose a protected action — browse stays available behind this banner. */
  soft?: boolean;
  onAuthenticated: () => void;
  onBan?: (ban: BanInfo) => void;
}) {
  const live = ban ? refreshBanInfo(ban) : undefined;
  const title = live
    ? 'Аккаунт заблокирован'
    : soft || !miniApp
      ? 'Войдите через Telegram'
      : 'Не удалось подтвердить Telegram';
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
    </> : <span>{message || (soft
      ? 'Войдите, чтобы покупать, продавать и писать в чат. Маркет и лоты можно смотреть без входа.'
      : 'Войдите через Telegram, чтобы продолжить.')}</span>}
  </div>
    {miniApp ? <Button variant="secondary" onClick={() => location.reload()}>Повторить</Button> :
      <WebsiteLoginEntry onAuthenticated={onAuthenticated} onBan={onBan} />}
  </div>;
}

function WebsiteLoginEntry({ onAuthenticated, onBan }: { onAuthenticated: () => void; onBan?: (ban: BanInfo) => void }) {
  const provider = getWebsiteLoginProvider();
  if (provider === 'widget') {
    return (
      <div className="auth-login">
        <TelegramLogin onBan={onBan} />
        <GoogleLoginButton onAuthenticated={onAuthenticated} onBan={onBan} />
      </div>
    );
  }
  return <BotTelegramLogin onAuthenticated={onAuthenticated} onBan={onBan} />;
}

function GoogleLoginButton(_props: { onAuthenticated: () => void; onBan?: (ban: BanInfo) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [clientId, setClientId] = useState<string | null>(
    () => import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || null,
  );
  const [redirectUri, setRedirectUri] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth_error') === 'google') {
      setError('Google вход не выполнен. Попробуйте ещё раз.');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getAuthV2PublicConfig()
      .then((cfg) => {
        if (cancelled) return;
        const fromApi = cfg.googleClientId?.trim() || null;
        if (fromApi) setClientId(fromApi);
        if (cfg.googleRedirectUri?.trim()) setRedirectUri(cfg.googleRedirectUri.trim());
      })
      .catch(() => {
        /* keep baked VITE_GOOGLE_CLIENT_ID if present */
      });
    return () => { cancelled = true; };
  }, []);

  if (!clientId) {
    return null;
  }
  return (
    <div>
      <button
        type="button"
        className="auth-btn auth-btn--google"
        disabled={busy}
        onClick={() => {
          setError('');
          setBusy(true);
          void (async () => {
            try {
              await postAuthV2Logout();
            } catch { /* previous cookie may already be gone */ }
            getSharedAuthManager().clearSession('logout');
            startGoogleOAuth(clientId, redirectUri);
          })();
        }}
      >
        <GoogleLogo />
        <span>{busy ? 'Переход в Google…' : 'Войти через Google'}</span>
      </button>
      {error && <small>{error}</small>}
    </div>
  );
}

function BotTelegramLogin({ onAuthenticated, onBan }: { onAuthenticated: () => void; onBan?: (ban: BanInfo) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');
  const [telegramLink, setTelegramLink] = useState<string | null>(null);
  const [startCommand, setStartCommand] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const onAuthenticatedRef = useRef(onAuthenticated);
  onAuthenticatedRef.current = onAuthenticated;

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  const onLogin = async () => {
    setError('');
    setBusy(true);
    setTelegramLink(null);
    setStartCommand(null);
    setHint('Откройте Telegram. Не закрывайте эту вкладку — вход завершится сам.');
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const started = await startBotLogin(controller.signal);
      const command = started.startCommand ?? `/start login_${started.challengeId}`;
      setTelegramLink(started.miniAppDeepLink || started.webDeepLink);
      setStartCommand(command);
      setHint('Если открылся чат без кнопок — нажмите MARKET или отправьте команду ниже. Старые кнопки «Подтвердить» недействительны — нужен новый вход с сайта.');
      try {
        await navigator.clipboard.writeText(command);
      } catch { /* ignore */ }
      openTelegramBotLogin(started.deepLink, started.webDeepLink, started.miniAppDeepLink);
      await waitAndCompleteBotLogin(started.challengeId, { signal: controller.signal });
      setHint('');
      setTelegramLink(null);
      setStartCommand(null);
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

  return <div className="auth-login">
    <button type="button" className="auth-btn auth-btn--telegram" onClick={() => void onLogin()} disabled={busy}>
      <TelegramLogo />
      <span>{busy ? 'Ожидание Telegram…' : 'Войти через Telegram'}</span>
    </button>
    <GoogleLoginButton onAuthenticated={onAuthenticated} onBan={onBan} />
    {telegramLink && (
      <p>
        <a href={telegramLink} target="_blank" rel="noopener noreferrer">Открыть Telegram ещё раз</a>
      </p>
    )}
    {startCommand && (
      <p>
        <small>Если Mini App не открылся, отправьте в чат бота:</small>
        {' '}
        <code className="auth-notice__command">{startCommand}</code>
      </p>
    )}
    {hint && <small>{hint}</small>}
    {error && <small>{error}</small>}
    <p className="auth-notice__legal muted">
      Входя, вы соглашаетесь с{' '}
      <a href="/privacy.html" target="_blank" rel="noopener noreferrer">политикой конфиденциальности</a>
      {' '}и обработкой данных Telegram / сессии для работы маркетплейса.
    </p>
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
    // RU: telegram.org can hang — fail soft so the page is not stuck waiting forever.
    const loadWatch = window.setTimeout(() => {
      if (!host.querySelector('iframe')) {
        setError('Виджет Telegram не ответил. Обновите страницу или включите вход через бота.');
      }
    }, 8_000);
    host.appendChild(script);

    return () => {
      window.clearTimeout(loadWatch);
      reportTelegramLoginError = () => {};
      reportTelegramBan = () => {};
      script.removeEventListener('error', handleError);
      script.remove();
      host.replaceChildren();
    };
  }, [bot, onBan]);
  if (!bot) return <span>Настройте VITE_TELEGRAM_BOT_USERNAME</span>;
  return <div>
    <div ref={hostRef} />
    {ban && <small>{formatBanRemaining(ban)}</small>}
    {error && <small>{error}</small>}
    <p className="auth-notice__legal muted">
      Входя, вы соглашаетесь с{' '}
      <a href="/privacy.html" target="_blank" rel="noopener noreferrer">политикой конфиденциальности</a>.
    </p>
  </div>;
}
export default AuthNotice;

/** Mini App opened with startapp=login_… — confirm the website tab instead of dropping into MARKET. */
export function WebsiteLoginBridge() {
  const [status, setStatus] = useState<'working' | 'ok' | 'fail'>('working');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const ok = await confirmWebsiteLoginFromMiniAppIfNeeded();
        if (!cancelled) setStatus(ok ? 'ok' : 'fail');
      } catch {
        if (!cancelled) setStatus('fail');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="auth-notice" role="status">
      <div>
        <strong>
          {status === 'working' && 'Подтверждаем вход…'}
          {status === 'ok' && 'Вход подтверждён'}
          {status === 'fail' && 'Не удалось подтвердить вход'}
        </strong>
        <span>
          {status === 'ok'
            ? 'Вернитесь на вкладку сайта ONIX в браузере. Вход завершится сам.'
            : status === 'fail'
              ? 'Вернитесь на сайт и нажмите «Войти через Telegram» ещё раз. Не закрывайте вкладку сайта.'
              : 'Не закрывайте вкладку сайта в браузере.'}
        </span>
      </div>
    </div>
  );
}

export function isWebsiteLoginStartParam(): boolean {
  return getTelegramStartParam().startsWith('login_');
}
