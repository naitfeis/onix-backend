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
import { Button, Card, Confirm, Field, Input, Modal, Skeleton, StateView, Textarea } from '../design-system';
import { formatOnixId } from '../utils/onixId';
import { publicAt } from '../utils/publicAt';
import { validateDraft } from '../utils/productValidation';
import { parseRublesToCents } from '../utils/moneyCents';
import type { Core, Screen } from './types';
import { ProductLotCard } from './ProductLotCard';
import { PublicProfileModal, StaffBadge, emptyDraft, staffBadgeFromRoles } from './shared';
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
  const needTelegram = profile.hasTelegram === false;
  const needGoogle = profile.hasTelegram !== false && profile.hasGoogle === false;
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
    if (!needGoogle) return;
    let cancelled = false;
    void getAuthV2PublicConfig()
      .then((cfg) => {
        if (cancelled) return;
        if (cfg.googleClientId?.trim()) setGoogleClientId(cfg.googleClientId.trim());
        if (cfg.googleRedirectUri?.trim()) setGoogleRedirect(cfg.googleRedirectUri.trim());
      })
      .catch(() => { /* keep baked client id */ });
    return () => { cancelled = true; };
  }, [needGoogle]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  if (!needTelegram && !needGoogle) return null;

  const linkTelegram = async () => {
    setBusy('telegram');
    setHint('Откройте Telegram и подтвердите привязку…');
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const started = await startBotLogin(controller.signal);
      openTelegramBotLogin(started.deepLink, started.webDeepLink, started.miniAppDeepLink);
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
    <div className="profile-link-banner" role="status">
      {needTelegram && (
        <>
          <p>
            Аккаунт Google: покупки доступны. Чтобы продавать, привяжите Telegram — имя и аватар тогда возьмутся из Telegram.
          </p>
          <Button
            type="button"
            variant="secondary"
            busy={busy === 'telegram'}
            disabled={busy !== null}
            onClick={() => void linkTelegram()}
          >
            {busy === 'telegram' ? 'Ожидание Telegram…' : 'Привязать Telegram'}
          </Button>
        </>
      )}
      {needGoogle && (
        <>
          <p>Привяжите Google, чтобы входить в этот же аккаунт и через Google.</p>
          {googleClientId ? (
            <Button
              type="button"
              variant="secondary"
              busy={busy === 'google'}
              disabled={busy !== null}
              onClick={() => {
                setBusy('google');
                startGoogleOAuth(googleClientId, googleRedirect, { intent: 'link' });
              }}
            >
              Привязать Google
            </Button>
          ) : (
            <p>Google вход на сервере не настроен.</p>
          )}
        </>
      )}
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
  const [payMethod, setPayMethod] = useState<'MANUAL' | 'TELEGRAM' | 'YOOKASSA'>('MANUAL');
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
    setPayMethod('MANUAL');
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
    const tick = async () => {
      try {
        const row = await api.get<{ status: string }>(API_PATHS.mfaStatus(stepUp.challengeId));
        if (cancelled) return;
        setStepUpStatus(row.status);
      } catch {
        /* keep polling */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
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
          provider: payMethod,
          idempotencyKey: key,
        });
        await api.post(API_PATHS.paymentIntentConfirm(intent.id), {});
        await core.loadProfile();
        setToast('Баланс пополнен.');
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
        setToast('Скоро: Telegram Wallet / ЮKassa. Manual-пополнение пока отключено.');
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
        ? 'Пополнение через PaymentIntent. Позже: Telegram Wallet / ЮKassa.'
        : 'Сумма и комиссия будут подтверждены сервером до списания.';

  return <div className="stack"><Card className="profile-card"><UserAvatar userId={profile.id} avatarUrl={profile.avatarUrl} name={profile.username} size="medium" online /><div className="profile-main"><h1>{publicAt(profile.username)} <StaffBadge badge={profile.badge ?? staffBadgeFromRoles(profile.roles)} /></h1><p>{formatOnixId(profile.onixId)} · Online</p><div className="stats"><span><b>★ {profile.rating.toFixed(1)}</b> рейтинг</span><span><b>{profile.salesCount}</b> сделок</span><span><b>{profile.followersCount}</b> подписчиков</span>{ownerTrust && <span><b>Уровень {ownerTrust.level}</b> доверия</span>}</div></div>
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
      {showWebsiteLogout && (
        <div className="profile-logout">
          <Button type="button" variant="ghost" className="profile-logout__btn" onClick={() => setLogoutOpen(true)}>
            Выйти из аккаунта
          </Button>
        </div>
      )}
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
        <button type="button" key="admin-plane" onClick={openAdminControlPlane}>ADMIN</button>
      )}
    </div>
    {section === 'overview' && <Card><h2>История баланса</h2>{walletHistory.length === 0 ? <p className="empty-inline">Операций пока нет.</p> : <>
      <div className="operations">{walletHistory.map(item => <div key={item.id}><span><b>{ledgerTypeLabel(item.type)}</b><small>{new Date(item.createdAt).toLocaleDateString('ru-RU')}</small></span><strong>{formatLedgerAmount(item.amountCents)}</strong></div>)}</div>
      {historyHasMore && (
        <div className="card-actions" style={{ marginTop: 12 }}>
          <Button variant="secondary" busy={historyLoadingMore} onClick={() => void loadMoreHistory()}>{t('common.showMore')}</Button>
        </div>
      )}
    </>}</Card>}
    {section === 'favorites' && (favoritesState === 'loading' ? <Card><Skeleton lines={4} /></Card> :
      favoritesState === 'error' ? <StateView title="Избранное недоступно" text="Не удалось загрузить список." /> :
      favoriteProducts.length === 0 ? <StateView title="Избранное пусто" text="Отмечайте товары сердцем на витрине." action={<Button onClick={() => switchTo('market')}>На рынок</Button>} /> :
      <div className="product-grid">{favoriteProducts.map(item => (
        <Card key={item.id} interactive className="product-card">
          <button type="button" className="product-main" onClick={() => openProductCard(item.id)} aria-label={`Открыть ${item.title}`}>
            {item.lotNumber != null && <div className="product-card__top"><span className="onixlot-id">ONIXLOT-{item.lotNumber}</span></div>}
            <h2>{item.title}</h2>
            <div className="seller-row">
              <span className="user-summary">
                <UserAvatar userId={item.seller.id} avatarUrl={item.seller.avatarUrl} name={item.seller.username} online={sellerIsPresent(item.seller, core.profile, core.presenceOf(item.seller.onixId))} />
                <span>{publicAt(item.seller.username)}</span>
              </span>
              <strong>{money(item.priceCents)}</strong>
            </div>
          </button>
        </Card>
      ))}</div>)}
    {section === 'listings' && (listingsState === 'loading' ? <Card><Skeleton lines={4} /></Card> :
      listingsState === 'error' ? <StateView title="Не удалось загрузить товары" text="Обновите вкладку или войдите снова." /> :
      ownProducts.length === 0 ? <StateView title="У вас нет товаров" text="Создайте первый лот — он появится здесь." action={<Button onClick={() => switchTo('create')}>Создать лот</Button>} /> :
      <><div className="product-grid product-grid--compact">{ownProducts.map(item => (
        <ProductLotCard
          key={item.id}
          product={item}
          core={core}
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
      core.reviews.map(review => <Card key={review.id}><div className="seller-row">
        {review.author.onixId
          ? <button type="button" className="linkish" onClick={() => void openAuthorProfile(review.author.onixId!)}><b>{publicAt(review.author.username)}</b> <StaffBadge badge={review.author.badge} /></button>
          : <b>{publicAt(review.author.username)} <StaffBadge badge={review.author.badge} /></b>}
        <span>{'★'.repeat(review.rating)}</span>
      </div><p className="muted">{review.text}</p></Card>))}
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
        {moneyModal === 'MAIN_TOPUP' && (
          <Field label="Способ оплаты">
            <div className="pay-methods" role="radiogroup" aria-label="Способ оплаты">
              {([
                { id: 'MANUAL' as const, label: 'Вручную (тест)' },
                { id: 'TELEGRAM' as const, label: 'Telegram Wallet' },
                { id: 'YOOKASSA' as const, label: 'ЮKassa' },
              ]).map((method) => (
                <button
                  key={method.id}
                  type="button"
                  role="radio"
                  aria-checked={payMethod === method.id}
                  className={`pay-methods__btn${payMethod === method.id ? ' is-active' : ''}`}
                  onClick={() => setPayMethod(method.id)}
                >
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
  </div>;
}
export default Profile;
