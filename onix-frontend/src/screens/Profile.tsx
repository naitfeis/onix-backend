import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { api, ApiError, friendlyError, money } from '../api/client';
import {
  API_PATHS, formatLedgerAmount, ledgerTypeLabel, sellerIsPresent,
  type Product, type ProductDraft, type PublicProfile, type WalletOperation,
} from '../api/contracts';
import { isTelegramMiniApp } from '../auth/telegramEnv';
import {
  getAuthV2PublicConfig,
  openTelegramBotLogin,
  startBotLogin,
  startGoogleOAuth,
  waitAndLinkBotTelegram,
} from '../auth';
import UserAvatar from '../components/UserAvatar';
import { CardLogo, GoogleLogo, SbpLogo, TelegramLogo } from '../components/BrandLogos';
import { Button, Card, Confirm, Field, Input, Modal, Skeleton, StateView, Textarea } from '../design-system';
import { formatOnixId } from '../utils/onixId';
import { publicAt } from '../utils/publicAt';
import { validateDraft } from '../utils/productValidation';
import { parseRublesToCents } from '../utils/moneyCents';
import type { Core, Screen } from './types';
import PaymentCheckout from './PaymentCheckout';
import { ProductLotCard } from './ProductLotCard';
import { PublicProfileModal, StaffBadge, emptyDraft, staffBadgeFromRoles } from './shared';
import { TrustLevelMeter } from '../components/TrustLevelMeter';
import { ReviewCard } from '../components/ReviewCard';
import { LedgerOpIcon } from '../components/LedgerOpIcon';
import { t } from '../i18n';

const SellerAnalyticsPanel = lazy(() => import('./SellerAnalytics'));

function openAdminControlPlane() {
  const url = `${window.location.origin}/admin/`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

type MoneyModal = 'MAIN_TOPUP' | 'MAIN_WITHDRAW' | 'DEPOSIT_FUND' | 'DEPOSIT_WITHDRAW' | null;

type StepUpState = {
  challengeId: string;
  webDeepLink?: string;
  expiresAt?: string;
  amountCents: number;
};

function rublesToCents(rubles: string | number): number {
  const cents = parseRublesToCents(rubles);
  return Number.isSafeInteger(cents) ? cents : Number.NaN;
}

function AccountLinkPanel({
  profile,
  onLinked,
  setToast,
}: {
  profile: { hasTelegram?: boolean; hasGoogle?: boolean };
  onLinked: () => Promise<unknown>;
  setToast: (text: string) => void;
}) {
  const telegramLinked = profile.hasTelegram !== false;
  const googleLinked = profile.hasGoogle === true;
  const [busy, setBusy] = useState<'telegram' | 'google' | null>(null);
  const [hint, setHint] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const [googleClientId, setGoogleClientId] = useState<string | null>(
    () => import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || null,
  );
  const [googleRedirect, setGoogleRedirect] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth_error') === 'google_link') {
      setToast('Google не привязан. Попробуйте ещё раз.');
      window.history.replaceState(null, '', window.location.pathname || '/');
    }
  }, [setToast]);

  useEffect(() => {
    if (googleLinked) return;
    let cancelled = false;
    void getAuthV2PublicConfig()
      .then((cfg) => {
        if (cancelled) return;
        if (cfg.googleClientId?.trim()) setGoogleClientId(cfg.googleClientId.trim());
        if (cfg.googleRedirectUri?.trim()) setGoogleRedirect(cfg.googleRedirectUri.trim());
      })
      .catch(() => { /* keep baked client id */ });
    return () => { cancelled = true; };
  }, [googleLinked]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const linkTelegram = async () => {
    setBusy('telegram');
    setHint('Откройте Telegram и подтвердите привязку…');
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const started = await startBotLogin(controller.signal);
      openTelegramBotLogin(started.deepLink, started.webDeepLink);
      await waitAndLinkBotTelegram(started.challengeId, { signal: controller.signal });
      await onLinked();
      setToast('Telegram привязан. Можно продавать.');
      setHint('');
    } catch (error) {
      if (controller.signal.aborted) return;
      setToast(friendlyError(error));
      setHint('Оставайтесь на вкладке — после подтверждения в Telegram привязка завершится сама.');
    } finally {
      if (!controller.signal.aborted) setBusy(null);
    }
  };

  return (
    <div className="profile-accounts" role="status">
      <div className="profile-account">
        <span className={`profile-account__mark${telegramLinked ? ' is-linked' : ''}`}>
          <TelegramLogo size={22} />
          {telegramLinked ? (
            <em className="profile-account__check" aria-label="Telegram привязан">✓</em>
          ) : null}
        </span>
        {!telegramLinked && (
          <button
            type="button"
            className="auth-btn auth-btn--telegram"
            disabled={busy !== null}
            onClick={() => void linkTelegram()}
          >
            <TelegramLogo size={18} />
            <span>{busy === 'telegram' ? 'Ожидание…' : 'Привязать'}</span>
          </button>
        )}
      </div>
      <div className="profile-account">
        {googleLinked ? (
          <span className="profile-account__mark is-linked">
            <GoogleLogo size={22} />
            <em className="profile-account__check" aria-label="Google привязан">✓</em>
          </span>
        ) : (
          <button
            type="button"
            className="auth-btn auth-btn--google"
            disabled={busy !== null}
            onClick={() => {
              void (async () => {
                setBusy('google');
                try {
                  let clientId = googleClientId;
                  let redirect = googleRedirect;
                  if (!clientId) {
                    const cfg = await getAuthV2PublicConfig();
                    clientId = cfg.googleClientId?.trim() || import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || null;
                    redirect = cfg.googleRedirectUri?.trim() || redirect;
                    if (clientId) setGoogleClientId(clientId);
                    if (redirect) setGoogleRedirect(redirect);
                  }
                  if (!clientId) {
                    setToast('Google сейчас недоступен. Обновите страницу.');
                    setBusy(null);
                    return;
                  }
                  startGoogleOAuth(clientId, redirect, { intent: 'link' });
                } catch (error) {
                  setToast(friendlyError(error));
                  setBusy(null);
                }
              })();
            }}
          >
            <GoogleLogo size={18} />
            <span>{busy === 'google' ? 'Переход…' : 'Привязать'}</span>
          </button>
        )}
      </div>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

export function EditProduct({ product, core, onClose, setToast }: { product: Product | null; core: Core; onClose: () => void; setToast: (text: string) => void }) {
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft);
  const [full, setFull] = useState<Product | null>(null);
  const [loadingDesc, setLoadingDesc] = useState(false);
  useEffect(() => {
    if (!product) {
      setFull(null);
      setDraft(emptyDraft);
      return;
    }
    let cancelled = false;
    setLoadingDesc(true);
    setDraft({
      title: product.title,
      description: product.description || '',
      priceRubles: String(Number(product.priceCents) / 100),
      quantity: product.quantity,
      category: product.category,
      subcategory: product.subcategory || '',
      autoDeliver: Boolean(product.autoDeliver),
      deliveryText: '',
    });
    // Catalog/mine cards may omit description — always reload detail for edit form.
    void api.get<Product>(`${API_PATHS.products}/${encodeURIComponent(product.id)}`)
      .then((row) => {
        if (cancelled) return;
        setFull(row);
        setDraft({
          title: row.title,
          description: row.description || '',
          priceRubles: String(Number(row.priceCents) / 100),
          quantity: row.quantity,
          category: row.category,
          subcategory: row.subcategory || '',
          autoDeliver: Boolean(row.autoDeliver),
          deliveryText: '',
        });
      })
      .catch(() => { if (!cancelled) setFull(product); })
      .finally(() => { if (!cancelled) setLoadingDesc(false); });
    return () => { cancelled = true; };
  }, [product]);
  const editing = full ?? product;
  return <Modal open={Boolean(product)} title="Редактировать товар" onClose={onClose}><form className="form" onSubmit={async event => {
    event.preventDefault();
    if (!editing) return;
    const keepSecret = Boolean(editing.autoDeliver && draft.autoDeliver && !draft.deliveryText?.trim());
    if (validateDraft(draft, { keepDeliverySecret: keepSecret }).length === 0 && await core.updateProduct(editing.id, draft)) {
      setToast('Изменения сохранены.');
      onClose();
    }
  }}>
    <Field label="Название" hint="До 32 символов"><Input maxLength={32} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></Field>
    <Field label="Описание" hint={loadingDesc ? 'Загрузка описания…' : undefined}>
      <Textarea maxLength={20000} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} disabled={loadingDesc} />
    </Field>
    <div className="form-grid"><Field label="Цена, ₽"><Input value={draft.priceRubles} onChange={event => setDraft({ ...draft, priceRubles: event.target.value })} /></Field><Field label="Количество"><Input type="number" min={1} value={draft.quantity} onChange={event => setDraft({ ...draft, quantity: Number(event.target.value) })} /></Field></div>
    <label className="check-row"><input type="checkbox" checked={Boolean(draft.autoDeliver)} onChange={event => setDraft({ ...draft, autoDeliver: event.target.checked })} /> Автоматическая выдача</label>
    {draft.autoDeliver && <Field label="Текст товара" hint={editing?.autoDeliver ? 'Оставьте пустым, чтобы сохранить текущий секрет. Новый текст заменит старый.' : 'login / password / код — выдаётся один раз после оплаты'}>
      <Textarea maxLength={4000} value={draft.deliveryText || ''} onChange={event => setDraft({ ...draft, deliveryText: event.target.value })} />
    </Field>}
    <div className="modal__actions"><Button type="button" variant="danger" busy={core.actionBusy === `archive-${editing?.id}`} onClick={async () => {
      if (editing && await core.archiveProduct(editing.id)) { setToast('Лот снят с публикации.'); onClose(); }
    }}>Снять</Button><Button type="button" variant="secondary" onClick={onClose}>Отмена</Button><Button type="submit" busy={core.actionBusy === 'product-form'}>Сохранить</Button></div>
  </form></Modal>;
}

function ListingViews({ count }: { count: number }) {
  return (
    <span className="listing-views" title="Уникальные просмотры">
      <svg className="listing-views__icon" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M12 5c-5.5 0-9.5 4.2-10.7 6.2a1.4 1.4 0 0 0 0 1.6C2.5 14.8 6.5 19 12 19s9.5-4.2 10.7-6.2a1.4 1.4 0 0 0 0-1.6C21.5 9.2 17.5 5 12 5Zm0 12c-3.9 0-7.1-2.9-8.4-5C4.9 9.9 8.1 7 12 7s7.1 2.9 8.4 5c-1.3 2.1-4.5 5-8.4 5Zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
      </svg>
      <b>{count}</b>
    </span>
  );
}

export function Profile({
  core, switchTo, setToast, openDirectChat, openProductCard,
  openTopup, onTopupConsumed,
}: {
  core: Core;
  switchTo: (screen: Screen) => void;
  setToast: (text: string) => void;
  openDirectChat: (onixId: string) => Promise<boolean>;
  openProductCard: (productId: string) => void;
  openTopup?: boolean;
  onTopupConsumed?: () => void;
}) {
  const [section, setSection] = useState<'overview' | 'listings' | 'favorites' | 'reviews' | 'analytics' | 'support'>('overview');
  const [moneyOpen, setMoneyOpen] = useState(false);
  const [moneyModal, setMoneyModal] = useState<MoneyModal>(null);
  const [moneyBusy, setMoneyBusy] = useState(false);
  const moneyLockRef = useRef(false);
  const moneyKeyRef = useRef(crypto.randomUUID());
  const [editing, setEditing] = useState<Product | null>(null);
  const [amount, setAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'SBP' | 'CARD'>('SBP');
  const [payIntentId, setPayIntentId] = useState<string | null>(null);
  const [authorProfile, setAuthorProfile] = useState<PublicProfile | null>(null);
  const [favoriteProducts, setFavoriteProducts] = useState<Product[]>([]);
  const [favoritesState, setFavoritesState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [ownProducts, setOwnProducts] = useState<Product[]>([]);
  const [listingsState, setListingsState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [listingsHasMore, setListingsHasMore] = useState(false);
  const [listingsLoadingMore, setListingsLoadingMore] = useState(false);
  const [walletHistory, setWalletHistory] = useState<WalletOperation[]>([]);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [appealOpen, setAppealOpen] = useState(false);
  const [appealText, setAppealText] = useState('');
  const [appealBusy, setAppealBusy] = useState(false);
  const [stepUp, setStepUp] = useState<StepUpState | null>(null);
  const [stepUpStatus, setStepUpStatus] = useState<string>('PENDING');
  const showWebsiteLogout = useMemo(() => !isTelegramMiniApp(), []);
  const PAGE = 15;
  const profile = core.profile;
  const deposit = profile?.deposit ?? null;
  const ownerTrust = profile?.trustCard ?? null;

  useEffect(() => {
    if (section !== 'overview' || !profile) return;
    const first = profile.walletHistory ?? [];
    setWalletHistory(first);
    setHistoryHasMore(first.length >= PAGE);
  }, [section, profile]);

  useEffect(() => {
    if (section !== 'listings' || !core.profile) return;
    let cancelled = false;
    setListingsState('loading');
    setOwnProducts([]);
    setListingsHasMore(false);
    void api.get<Product[]>(API_PATHS.productsMineList({ limit: PAGE, offset: 0 }))
      .then((rows) => {
        if (cancelled) return;
        setOwnProducts(rows);
        setListingsHasMore(rows.length >= PAGE);
        setListingsState('success');
      })
      .catch(() => {
        if (cancelled) return;
        setOwnProducts([]);
        setListingsHasMore(false);
        setListingsState('error');
      });
    return () => { cancelled = true; };
  }, [core.profile, section, editing]);

  const loadMoreHistory = async () => {
    if (historyLoadingMore || !historyHasMore) return;
    setHistoryLoadingMore(true);
    try {
      const rows = await api.get<WalletOperation[]>(
        API_PATHS.walletLedger({ limit: PAGE, offset: walletHistory.length }),
      );
      setWalletHistory((prev) => {
        const seen = new Set(prev.map((item) => item.id));
        return [...prev, ...rows.filter((item) => !seen.has(item.id))];
      });
      setHistoryHasMore(rows.length >= PAGE);
    } catch {
      setToast('Не удалось загрузить историю баланса.');
    } finally {
      setHistoryLoadingMore(false);
    }
  };

  const loadMoreListings = async () => {
    if (listingsLoadingMore || !listingsHasMore) return;
    setListingsLoadingMore(true);
    try {
      const rows = await api.get<Product[]>(
        API_PATHS.productsMineList({ limit: PAGE, offset: ownProducts.length }),
      );
      setOwnProducts((prev) => {
        const seen = new Set(prev.map((item) => item.id));
        return [...prev, ...rows.filter((item) => !seen.has(item.id))];
      });
      setListingsHasMore(rows.length >= PAGE);
    } catch {
      setToast('Не удалось загрузить товары.');
    } finally {
      setListingsLoadingMore(false);
    }
  };

  useEffect(() => {
    if (section !== 'favorites' || !core.profile) return;
    let cancelled = false;
    setFavoritesState('loading');
    void core.listFavorites().then((rows) => {
      if (cancelled) return;
      setFavoriteProducts(rows);
      setFavoritesState('success');
    }).catch(() => {
      if (cancelled) return;
      setFavoriteProducts([]);
      setFavoritesState('error');
    });
    return () => { cancelled = true; };
  }, [core.listFavorites, core.profile, section]);

  const openMoney = (kind: Exclude<MoneyModal, null>) => {
    setAmount('');
    setPayMethod('SBP');
    setMoneyOpen(true);
    moneyKeyRef.current = crypto.randomUUID();
    setMoneyModal(kind);
  };

  useEffect(() => {
    if (!openTopup || !core.profile) return;
    openMoney('MAIN_TOPUP');
    onTopupConsumed?.();
  }, [openTopup, core.profile, onTopupConsumed]);

  useEffect(() => {
    if (!stepUp) return;
    let cancelled = false;
    let intervalId = 0;
    const stop = () => {
      if (intervalId) window.clearInterval(intervalId);
      intervalId = 0;
    };
    const tick = async () => {
      try {
        const row = await api.get<{ status: string }>(API_PATHS.mfaStatus(stepUp.challengeId));
        if (cancelled) return;
        setStepUpStatus(row.status);
        if (row.status === 'VERIFIED' || row.status === 'EXPIRED' || row.status === 'CANCELED' || row.status === 'FAILED') {
          stop();
        }
      } catch {
        /* keep polling */
      }
    };
    void tick();
    intervalId = window.setInterval(() => void tick(), 2500);
    return () => {
      cancelled = true;
      stop();
    };
  }, [stepUp]);

  const completeWithdraw = async (amountCents: number, stepUpChallengeId?: string) => {
    await api.post(API_PATHS.walletWithdraw, {
      amountCents: String(amountCents),
      idempotencyKey: moneyKeyRef.current,
      ...(stepUpChallengeId ? { stepUpChallengeId } : {}),
    });
    await core.loadProfile();
    setToast('Заявка на вывод создана.');
    setMoneyModal(null);
    setAmount('');
    setStepUp(null);
  };

  const submitMoney = async () => {
    if (moneyLockRef.current || moneyBusy) return;
    const amountCents = rublesToCents(amount);
    if (!moneyModal || !Number.isSafeInteger(amountCents) || amountCents < 100) return;
    moneyLockRef.current = true;
    setMoneyBusy(true);
    try {
      const key = moneyKeyRef.current;
      if (moneyModal === 'MAIN_WITHDRAW') {
        try {
          await completeWithdraw(amountCents);
        } catch (error) {
          if (error instanceof ApiError && error.code === 'AUTH_STEP_UP_REQUIRED') {
            const details = error.details as {
              challengeId?: string;
              webDeepLink?: string;
              expiresAt?: string;
            } | undefined;
            if (details?.challengeId) {
              setStepUp({
                challengeId: details.challengeId,
                webDeepLink: details.webDeepLink,
                expiresAt: details.expiresAt,
                amountCents,
              });
              setStepUpStatus('PENDING');
              setToast('Подтвердите вывод в Telegram.');
              return;
            }
          }
          throw error;
        }
        return;
      } else if (moneyModal === 'MAIN_TOPUP') {
        const intent = await api.post<{ id: string }>(API_PATHS.paymentsIntents, {
          wallet: 'MAIN',
          amountCents,
          provider: payMethod === 'CARD' ? 'CARD' : 'YOOKASSA',
          idempotencyKey: key,
        });
        setMoneyModal(null);
        setAmount('');
        setPayIntentId(intent.id);
        setToast('Откройте оплату Т-Банка. Баланс обновится после QR/СБП.');
        return;
      } else if (moneyModal === 'DEPOSIT_FUND') {
        await api.post(API_PATHS.walletDepositTopup, { amountCents, idempotencyKey: key });
        await core.loadProfile();
        setToast('Залог пополнен с баланса.');
      } else if (moneyModal === 'DEPOSIT_WITHDRAW') {
        await api.post(API_PATHS.walletDepositWithdraw, { amountCents, idempotencyKey: key });
        await core.loadProfile();
        setToast('Залог выведен на баланс.');
      }
      setMoneyModal(null);
      setAmount('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Операция недоступна.';
      if (moneyModal === 'MAIN_TOPUP' && (message.includes('не подключ') || message.includes('отключено') || message.includes('Manual'))) {
        setToast(message.includes('TINKOFF') ? message : 'Скоро: Telegram Wallet / ЮKassa. Manual-пополнение пока отключено.');
      } else {
        setToast(message);
      }
    } finally {
      moneyLockRef.current = false;
      setMoneyBusy(false);
    }
  };

  const retryWithdrawAfterStepUp = async () => {
    if (!stepUp || moneyLockRef.current) return;
    moneyLockRef.current = true;
    setMoneyBusy(true);
    try {
      await completeWithdraw(stepUp.amountCents, stepUp.challengeId);
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Не удалось завершить вывод.');
    } finally {
      moneyLockRef.current = false;
      setMoneyBusy(false);
    }
  };

  if (core.states.profile === 'loading') return <Card><Skeleton lines={6} /></Card>;
  if (!profile) return <StateView title="Профиль недоступен" text={core.errors.profile || 'Войдите через Telegram.'} action={<Button onClick={core.refreshAll}>Обновить</Button>} />;
  const status = profile.status ?? (profile.roles[0] ?? 'USER');
  const isAdmin = status === 'ADMIN' || status === 'SUPER_ADMIN' || profile.isAdmin
    || profile.roles.includes('ADMIN') || profile.roles.includes('SUPER_ADMIN');
  const profileSections: Array<'overview' | 'listings' | 'favorites' | 'reviews' | 'analytics'> = [
    'overview', 'listings', 'favorites', 'reviews', 'analytics',
  ];
  const openAuthorProfile = async (onixId: string) => {
    try {
      setAuthorProfile(await api.get<PublicProfile>(API_PATHS.userPublic(onixId)));
    } catch (error) {
      setToast(friendlyError(error));
    }
  };

  const moneyTitle = moneyModal === 'MAIN_TOPUP' ? 'Пополнить баланс'
    : moneyModal === 'MAIN_WITHDRAW' ? 'Вывод средств'
    : moneyModal === 'DEPOSIT_FUND' ? 'Пополнить залог'
    : moneyModal === 'DEPOSIT_WITHDRAW' ? 'Вывести залог'
    : '';
  const moneyHint = moneyModal === 'DEPOSIT_FUND'
    ? 'Сумма спишется с основного баланса и зачислится в доступный залог.'
    : moneyModal === 'DEPOSIT_WITHDRAW'
      ? 'Только доступный залог. Замороженные средства после сделки нельзя вывести до конца HOLD.'
      : moneyModal === 'MAIN_TOPUP'
        ? 'Пополнение через СБП или банковскую карту.'
        : 'Вывод на СБП или банковскую карту. Сумма и комиссия подтверждаются сервером.';

  return <div className="stack">
    {profile.securityLock?.locked && (
      <Card className="security-lock-banner" role="alert">
        <strong>Аккаунт временно ограничен</strong>
        <p>Причина: подозрительная активность{profile.securityLock.caseId ? `. ID дела: ${profile.securityLock.caseId}` : ''}</p>
        <p className="muted">Данные сохранены. Вы можете обжаловать решение — аккаунт не удалён.</p>
        <Button type="button" onClick={() => setAppealOpen(true)}>Обжаловать решение</Button>
      </Card>
    )}
    <Card className="profile-card"><UserAvatar userId={profile.id} avatarUrl={profile.avatarUrl} name={profile.username} size="medium" online /><div className="profile-main"><h1>{publicAt(profile.username)} <StaffBadge badge={profile.badge ?? staffBadgeFromRoles(profile.roles)} /></h1><p>{formatOnixId(profile.onixId)} · Online</p><div className="stats"><span><b>★ {profile.rating.toFixed(1)}</b> рейтинг</span><span><b>{profile.salesCount}</b> сделок</span><span><b>{profile.followersCount}</b> подписчиков</span>{ownerTrust && <TrustLevelMeter level={ownerTrust.level} progress={ownerTrust.progress} className="trust-meter--inline" />}</div></div>
      {showWebsiteLogout && (
        <div className="profile-logout">
          <Button type="button" variant="ghost" className="profile-logout__btn" onClick={() => setLogoutOpen(true)}>
            Выйти из аккаунта
          </Button>
        </div>
      )}
      <div className="wallet-strip">
        <button type="button" className="wallet-strip__row" onClick={() => setMoneyOpen((v) => !v)} aria-expanded={moneyOpen}>
          <span><small>Баланс</small><strong>{money(profile.balanceCents)}</strong></span>
          <span><small>Залог</small><strong>{money(deposit?.totalCents ?? '0')}</strong></span>
          <em className={`wallet-strip__chevron${moneyOpen ? ' open' : ''}`} aria-hidden="true">▾</em>
        </button>
        {moneyOpen && (
          <div className="wallet-strip__panel">
            <div className="balance"><small>БАЛАНС</small><strong>{money(profile.balanceCents)}</strong><div className="balance-actions"><Button variant="secondary" onClick={() => openMoney('MAIN_WITHDRAW')}>Вывести</Button><Button variant="secondary" onClick={() => openMoney('MAIN_TOPUP')}>Пополнить</Button></div></div>
            <div className="balance"><small>ЗАЛОГ</small><strong>{money(deposit?.totalCents ?? '0')}</strong><div className="balance-actions"><Button variant="secondary" onClick={() => openMoney('DEPOSIT_WITHDRAW')}>Вывести</Button><Button variant="secondary" onClick={() => openMoney('DEPOSIT_FUND')}>Пополнить</Button></div></div>
            {deposit && <div className="stats"><span><b>{money(deposit.totalCents)}</b> всего</span><span><b>{money(deposit.availableCents)}</b> доступно</span><span><b>{money(deposit.lockedCents)}</b> заморожено</span></div>}
          </div>
        )}
      </div>
      <AccountLinkPanel profile={profile} onLinked={() => core.loadProfile()} setToast={setToast} />
    </Card>
    {showWebsiteLogout && (
      <Confirm
        open={logoutOpen}
        title="Выйти из аккаунта?"
        text="Сессия на этом устройстве будет завершена. Чтобы снова пользоваться профилем, войдите через Telegram."
        dangerous
        busy={logoutBusy}
        onCancel={() => { if (!logoutBusy) setLogoutOpen(false); }}
        onConfirm={() => {
          void (async () => {
            setLogoutBusy(true);
            try {
              await core.signOut();
              setToast('Вы вышли из аккаунта.');
            } catch (error) {
              setToast(friendlyError(error));
            } finally {
              setLogoutBusy(false);
              setLogoutOpen(false);
            }
          })();
        }}
      />
    )}
    <div className="chips profile-tabs">
      {profileSections.map(item =>
        <button className={section === item ? 'active' : ''} key={item} onClick={() => setSection(item)}>{({
          overview: t('profile.history'),
          listings: t('profile.listings'),
          favorites: t('profile.favorites'),
          reviews: t('profile.reviews'),
          analytics: t('profile.analytics'),
        })[item]}</button>)}
      {isAdmin && (
        <button type="button" key="admin-plane" onClick={openAdminControlPlane}>{t('profile.admin')}</button>
      )}
    </div>
    {section === 'overview' && <Card><h2>История баланса</h2>{walletHistory.length === 0 ? <p className="empty-inline">Операций пока нет.</p> : <>
      <div className="operations">{walletHistory.map(item => (
        <div key={item.id} className="operations__row">
          <LedgerOpIcon type={item.type} />
          <span>
            <b>{ledgerTypeLabel(item.type)}</b>
            <small>{new Date(item.createdAt).toLocaleDateString('ru-RU')}</small>
          </span>
          <strong>{formatLedgerAmount(item.amountCents)}</strong>
        </div>
      ))}</div>
      {historyHasMore && (
        <div className="card-actions" style={{ marginTop: 12 }}>
          <Button variant="secondary" busy={historyLoadingMore} onClick={() => void loadMoreHistory()}>{t('common.showMore')}</Button>
        </div>
      )}
    </>}</Card>}
    {section === 'favorites' && (favoritesState === 'loading' ? <Card><Skeleton lines={4} /></Card> :
      favoritesState === 'error' ? <StateView title="Избранное недоступно" text="Не удалось загрузить список." /> :
      favoriteProducts.length === 0 ? <StateView title="Избранное пусто" text="Отмечайте товары сердцем на витрине." action={<Button onClick={() => switchTo('market')}>На рынок</Button>} /> :
      <div className="product-grid product-grid--compact">{favoriteProducts.map(item => (
        <ProductLotCard
          key={item.id}
          product={item}
          online={sellerIsPresent(item.seller, core.profile, core.presenceOf(item.seller.onixId))}
          onOpen={() => openProductCard(item.id)}
          onFavorite={() => {
            setFavoriteProducts((prev) => prev.filter((row) => row.id !== item.id));
            void core.toggleFavorite(item);
          }}
        />
      ))}</div>)}
    {section === 'listings' && (listingsState === 'loading' ? <Card><Skeleton lines={4} /></Card> :
      listingsState === 'error' ? <StateView title="Не удалось загрузить товары" text="Обновите вкладку или войдите снова." /> :
      ownProducts.length === 0 ? <StateView title="У вас нет товаров" text="Создайте первый лот — он появится здесь." action={<Button onClick={() => switchTo('create')}>Создать лот</Button>} /> :
      <><div className="product-grid product-grid--compact">{ownProducts.map(item => (
        <ProductLotCard
          key={item.id}
          product={item}
          online={sellerIsPresent(item.seller, core.profile, core.presenceOf(item.seller.onixId))}
          onOpen={() => setEditing(item)}
          footer={(
            <div className="product-card__footer product-card__footer--bar">
              <ListingViews count={item.viewCount ?? 0} />
              <strong className="product-card__price">{money(item.priceCents)}</strong>
              <Button variant="secondary" onClick={() => setEditing(item)}>Редактировать</Button>
            </div>
          )}
        />
      ))}</div>
      {listingsHasMore && (
        <div className="card-actions" style={{ marginTop: 12 }}>
          <Button variant="secondary" busy={listingsLoadingMore} onClick={() => void loadMoreListings()}>{t('common.showMore')}</Button>
        </div>
      )}
      </>)}
    {section === 'reviews' && (core.reviews.length === 0 ? <StateView title="Отзывов пока нет" text="Отзывы можно оставить после завершённой сделки." /> :
      <div className="review-list">{core.reviews.map(review => (
        <ReviewCard
          key={review.id}
          review={review}
          authorBadge={<StaffBadge badge={review.author.badge} />}
          onOpenAuthor={(onixId) => { void openAuthorProfile(onixId); }}
          ownerMenu={{
            onReport: () => {
              void (async () => {
                const comment = window.prompt('Почему отзыв нужно снять?');
                if (!comment?.trim()) return;
                try {
                  await api.post(API_PATHS.reviewAppeal(review.id), { comment: comment.trim() });
                  setToast('Жалоба на отзыв отправлена в поддержку.');
                } catch (error) {
                  setToast(friendlyError(error));
                }
              })();
            },
            onReply: () => {
              void (async () => {
                const onixId = review.author.onixId;
                if (!onixId) {
                  setToast('Нельзя ответить: автор отзыва недоступен.');
                  return;
                }
                const ok = await openDirectChat(onixId);
                if (!ok) setToast('Не удалось открыть чат с автором отзыва.');
              })();
            },
          }}
        />
      ))}</div>)}
    {section === 'analytics' && (
      <Suspense fallback={<Card><Skeleton lines={6} /></Card>}>
        <SellerAnalyticsPanel />
      </Suspense>
    )}
    <PublicProfileModal
      profile={authorProfile}
      onClose={() => setAuthorProfile(null)}
      core={core}
      onOpenOnix={openAuthorProfile}
      onWrite={async (onixId) => {
        setAuthorProfile(null);
        await openDirectChat(onixId);
      }}
      onOpenProduct={(productId) => {
        setAuthorProfile(null);
        openProductCard(productId);
      }}
      setToast={setToast}
    />
    <EditProduct product={editing} core={core} onClose={() => setEditing(null)} setToast={setToast} />
    <Modal open={Boolean(moneyModal)} title={moneyTitle} onClose={() => setMoneyModal(null)}>
      <div className="form money-form">
        <p className="modal__text">{moneyHint}</p>
        <Field label="Сумма, ₽">
          <Input
            inputMode="decimal"
            value={amount}
            onChange={event => setAmount(event.target.value)}
            placeholder="Например, 1000"
            aria-label="Сумма пополнения"
          />
        </Field>
        {(moneyModal === 'MAIN_TOPUP' || moneyModal === 'MAIN_WITHDRAW') && (
          <Field label={moneyModal === 'MAIN_WITHDRAW' ? 'Куда вывести' : 'Способ оплаты'}>
            <div className="pay-methods" role="radiogroup" aria-label={moneyModal === 'MAIN_WITHDRAW' ? 'Куда вывести' : 'Способ оплаты'}>
              {([
                { id: 'SBP' as const, label: 'СБП', icon: <SbpLogo size={22} /> },
                { id: 'CARD' as const, label: 'Банковская карта', icon: <CardLogo size={22} /> },
              ]).map((method) => (
                <button
                  key={method.id}
                  type="button"
                  role="radio"
                  aria-checked={payMethod === method.id}
                  className={`pay-methods__btn${payMethod === method.id ? ' is-active' : ''}`}
                  onClick={() => setPayMethod(method.id)}
                >
                  <span className="pay-methods__icon" aria-hidden="true">{method.icon}</span>
                  {method.label}
                </button>
              ))}
            </div>
          </Field>
        )}
        <div className="modal__actions money-form__actions">
          <Button variant="secondary" onClick={() => setMoneyModal(null)}>{t('common.cancel')}</Button>
          <Button
            variant="violet"
            busy={moneyBusy || (moneyModal === 'MAIN_WITHDRAW' && core.actionBusy === 'withdraw')}
            disabled={!Number.isSafeInteger(rublesToCents(amount)) || rublesToCents(amount) < 100}
            onClick={() => void submitMoney()}
          >Продолжить</Button>
        </div>
      </div>
    </Modal>
    <Modal
      open={Boolean(stepUp)}
      title="Подтверждение вывода"
      onClose={() => { setStepUp(null); setStepUpStatus('PENDING'); }}
    >
      <div className="stack compact">
        <p className="muted">
          Для этого вывода нужно подтверждение в Telegram.
          {stepUpStatus === 'CONFIRMED'
            ? ' Подтверждение получено — нажмите «Повторить вывод».'
            : ' Откройте бота и нажмите «Подтвердить».'}
        </p>
        {stepUp?.webDeepLink && stepUpStatus !== 'CONFIRMED' && (
          <Button
            variant="secondary"
            onClick={() => window.open(stepUp.webDeepLink, '_blank', 'noopener,noreferrer')}
          >Открыть Telegram</Button>
        )}
        <p className="muted">Статус: {stepUpStatus}</p>
        <div className="modal__actions">
          <Button variant="secondary" onClick={() => setStepUp(null)}>Отмена</Button>
          <Button
            variant="violet"
            busy={moneyBusy}
            disabled={stepUpStatus !== 'CONFIRMED'}
            onClick={() => void retryWithdrawAfterStepUp()}
          >Повторить вывод</Button>
        </div>
      </div>
    </Modal>
    <Modal open={appealOpen} title="Обжаловать ограничение" onClose={() => setAppealOpen(false)}>
      <form className="form" onSubmit={async (event) => {
        event.preventDefault();
        const text = appealText.trim();
        if (text.length < 8) {
          setToast('Опишите ситуацию подробнее.');
          return;
        }
        setAppealBusy(true);
        try {
          const result = await api.post<{ publicId: string; caseId?: string | null }>(API_PATHS.supportAppeal, {
            explanation: text,
          });
          setAppealOpen(false);
          setAppealText('');
          setToast(`Апелляция ${result.publicId} отправлена.`);
        } catch (error) {
          setToast(friendlyError(error));
        } finally {
          setAppealBusy(false);
        }
      }}>
        <p className="muted">
          {profile.securityLock?.caseId ? `Дело ${profile.securityLock.caseId}. ` : ''}
          Напишите объяснение. Решение примет модератор — аккаунт не будет удалён автоматически.
        </p>
        <Field label="Объяснение">
          <Textarea maxLength={2000} value={appealText} onChange={(e) => setAppealText(e.target.value)} />
        </Field>
        <div className="modal__actions">
          <Button type="button" variant="secondary" onClick={() => setAppealOpen(false)}>Отмена</Button>
          <Button type="submit" busy={appealBusy}>Отправить апелляцию</Button>
        </div>
      </form>
    </Modal>
    <PaymentCheckout
      intentId={payIntentId}
      onCancel={() => setPayIntentId(null)}
      onDone={() => {
        setPayIntentId(null);
        void core.loadProfile();
        setToast('Баланс пополнен.');
      }}
    />
  </div>;
}
export default Profile;
