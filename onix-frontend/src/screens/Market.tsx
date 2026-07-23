import { useEffect, useRef, useState } from 'react';
import { api, money, friendlyError } from '../api/client';
import {
  API_PATHS, CATEGORIES, CATEGORY_LABELS, SUBCATEGORIES_BY_CATEGORY, SUBCATEGORY_LABELS,
  formatLastSeen, sellerIsPresent, type Product, type PublicProfile, type TrustCard,
} from '../api/contracts';
import UserAvatar from '../components/UserAvatar';
import { IconStar, IconWallet } from '../components/NavIcons';
import { Button, Card, Confirm, Input, Modal, Select, Skeleton, StateView } from '../design-system';
import { t } from '../i18n';
import { formatOnixId } from '../utils/onixId';
import { publicAt } from '../utils/publicAt';
import { CATEGORY_IMAGES } from '../utils/categoryImages';
import type { Core, Screen } from './types';
import { PublicProfileModal, StaffBadge } from './shared';

const CAT_STYLE: Record<string, { bg: string; glow: string; letter: string }> = {
  STANDOFF_2: { bg: 'linear-gradient(145deg,#E8B93E,#C4982E)', glow: 'rgba(232,185,62,.35)', letter: 'S2' },
  STEAM: { bg: 'linear-gradient(145deg,#4A8FE0,#346FB8)', glow: 'rgba(74,143,224,.32)', letter: 'ST' },
  ROBLOX: { bg: 'linear-gradient(145deg,#5B8DEF,#3D6FD4)', glow: 'rgba(91,141,239,.32)', letter: 'RB' },
  RP_PROJECTS: { bg: 'linear-gradient(145deg,#8B7FF5,#6B5FE0)', glow: 'rgba(139,127,245,.32)', letter: 'RP' },
  BRAWL_STARS: { bg: 'linear-gradient(145deg,#E8934A,#C47535)', glow: 'rgba(232,147,74,.32)', letter: 'BS' },
  OTHER: { bg: 'linear-gradient(145deg,#8A8B96,#63646E)', glow: 'rgba(138,139,150,.28)', letter: '··' },
};

function formatCatCount(n: number): string {
  if (n <= 0) return '';
  if (n > 99) return '99+';
  return String(n);
}

export function Market({
  core, switchTo, setToast, focusProductId, onFocusProductHandled, openDirectChat, openProductCard, openDealChat,
  externalCategory, onExternalCategoryConsumed, openTopup,
}: {
  core: Core;
  switchTo: (screen: Screen) => void;
  setToast: (text: string) => void;
  focusProductId: string | null;
  onFocusProductHandled: () => void;
  openDirectChat: (onixId: string) => Promise<boolean>;
  openProductCard: (productId: string) => void;
  openDealChat: (chatId: string) => void;
  externalCategory?: string;
  onExternalCategoryConsumed?: () => void;
  openTopup?: () => void;
}) {
  const [selected, setSelected] = useState<Product | null>(null);
  const [confirm, setConfirm] = useState<Product | null>(null);
  const [sellerProfile, setSellerProfile] = useState<PublicProfile | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Все');
  const [subcategory, setSubcategory] = useState('');
  const [sort, setSort] = useState('new');
  const [items, setItems] = useState<Product[]>([]);
  const [marketState, setMarketState] = useState<'loading' | 'success' | 'error'>('loading');
  const [marketError, setMarketError] = useState<string | undefined>();
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sellerTrust, setSellerTrust] = useState<TrustCard | null>(null);
  const [detailReady, setDetailReady] = useState(false);
  const [heroSlide, setHeroSlide] = useState(0);
  const heroTrackRef = useRef<HTMLDivElement>(null);
  const PAGE = 15;
  const isAdmin = Boolean(
    core.profile?.isAdmin
    || core.profile?.status === 'ADMIN'
    || core.profile?.roles.includes('ADMIN'),
  );
  const greetName = core.profile ? publicAt(core.profile.username) : 'гость';
  const heroSlides = [
    {
      id: 'hello',
      title: `Привет - ${greetName}`,
      text: 'Добро пожаловать в ONIX. Безопасные сделки и свежие лоты уже ждут.',
      cta: 'Смотреть лоты' as const,
      action: 'browse' as const,
    },
    {
      id: 'safe',
      title: 'Безопасный маркет аккаунтов',
      text: 'Сейф-сделки, рейтинг продавцов и мгновенная доставка — стекло поверх живой сцены.',
      cta: 'Разместить лот' as const,
      action: 'create' as const,
    },
    {
      id: 'sell',
      title: 'Продай аккаунт без риска',
      text: 'Размести лот за минуту — деньги на сделке держатся в сейфе до подтверждения.',
      cta: 'Разместить лот' as const,
      action: 'create' as const,
    },
  ];

  const lotLabel = (product: Product) => (
    product.lotNumber != null ? `ONIXLOT-${product.lotNumber}` : null
  );

  const openProduct = async (product: Product) => {
    setSelected(product);
    setDetailReady(false);
    setSellerProfile(null);
    setSellerTrust(null);
    try {
      const [full, trust] = await Promise.all([
        api.get<Product>(`${API_PATHS.products}/${encodeURIComponent(product.id)}`),
        api.get<TrustCard>(API_PATHS.userTrustCard(product.seller.onixId)).catch(() => null),
      ]);
      setSelected(full);
      setDetailReady(true);
      if (trust) setSellerTrust(trust);
      if (core.profile) {
        void api.post(API_PATHS.productView(full.id), {
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        }).catch(() => { /* ignore view errors */ });
      }
    } catch {
      setDetailReady(true);
      setToast('Не удалось загрузить карточку товара.');
    }
  };

  const onixQuery = query.trim().match(/^ONIX-\d+$/i)?.[0]?.toUpperCase();
  const marketSubs = category !== 'Все'
    ? (SUBCATEGORIES_BY_CATEGORY[category as typeof CATEGORIES[number]] ?? [])
    : [];

  useEffect(() => {
    if (!externalCategory || externalCategory === 'Все') return;
    setCategory(externalCategory);
    setSubcategory('');
    onExternalCategoryConsumed?.();
  }, [externalCategory, onExternalCategoryConsumed]);

  useEffect(() => {
    const controller = new AbortController();
    const debounceMs = query.trim() ? 300 : 0;
    const timer = window.setTimeout(() => {
      setMarketState('loading');
      setOffset(0);
      const serverSort = sort === 'price' ? 'price_asc' as const : sort === 'rating' ? 'rating' as const : 'newest' as const;
      void core.listProducts({
        search: query.trim() || undefined,
        category: category === 'Все' ? undefined : category,
        subcategory: subcategory || undefined,
        sort: serverSort,
        limit: PAGE,
        offset: 0,
      }, controller.signal).then((data) => {
        setItems(data);
        setHasMore(data.length >= PAGE);
        setMarketError(undefined);
        setMarketState('success');
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setItems([]);
        setHasMore(false);
        setMarketError(friendlyError(error));
        setMarketState('error');
      });
    }, debounceMs);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [category, core.listProducts, query, sort, subcategory]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const next = offset + PAGE;
    const serverSort = sort === 'price' ? 'price_asc' as const : sort === 'rating' ? 'rating' as const : 'newest' as const;
    try {
      const data = await core.listProducts({
        search: query.trim() || undefined,
        category: category === 'Все' ? undefined : category,
        subcategory: subcategory || undefined,
        sort: serverSort,
        limit: PAGE,
        offset: next,
      });
      setItems((prev) => [...prev, ...data]);
      setOffset(next);
      setHasMore(data.length >= PAGE);
    } catch (error) {
      setToast(friendlyError(error));
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (!selected) return;
    const fresh = items.find((item) => item.id === selected.id)
      ?? core.products.find((item) => item.id === selected.id);
    if (!fresh || fresh.favorite === selected.favorite) return;
    setSelected((prev) => (
      prev && prev.id === fresh.id ? { ...prev, favorite: fresh.favorite } : prev
    ));
  }, [core.products, items, selected]);

  useEffect(() => {
    if (!focusProductId) return;
    let cancelled = false;
    void (async () => {
      try {
        const fromList = items.find((item) => item.id === focusProductId)
          ?? core.products.find((item) => item.id === focusProductId);
        if (fromList) {
          if (cancelled) return;
          await openProduct(fromList);
        } else {
          const product = await api.get<Product>(`${API_PATHS.products}/${encodeURIComponent(focusProductId)}`);
          if (cancelled) return;
          await openProduct(product);
        }
      } catch { /* ignore */ }
      finally {
        if (!cancelled) onFocusProductHandled();
      }
    })();
    return () => { cancelled = true; };
  }, [focusProductId]);

  const categoryCounts = CATEGORIES.reduce<Record<string, number>>((acc, cat) => {
    const fromCore = core.products.filter((p) => p.category === cat).length;
    const fromPage = items.filter((p) => p.category === cat).length;
    acc[cat] = Math.max(fromCore, fromPage);
    return acc;
  }, {});
  const totalVisible = Math.max(items.length, core.products.length);

  const goHeroSlide = (index: number) => {
    const next = ((index % heroSlides.length) + heroSlides.length) % heroSlides.length;
    setHeroSlide(next);
    const track = heroTrackRef.current;
    if (!track) return;
    const slide = track.children[next] as HTMLElement | undefined;
    slide?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  };

  useEffect(() => {
    const track = heroTrackRef.current;
    if (!track) return;
    const onScroll = () => {
      const width = track.clientWidth || 1;
      const index = Math.round(track.scrollLeft / width);
      setHeroSlide(Math.min(Math.max(index, 0), heroSlides.length - 1));
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    return () => track.removeEventListener('scroll', onScroll);
  }, [heroSlides.length]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => {
      setHeroSlide((current) => {
        const next = (current + 1) % heroSlides.length;
        const track = heroTrackRef.current;
        if (track) {
          const slide = track.children[next] as HTMLElement | undefined;
          slide?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
        }
        return next;
      });
    }, 6500);
    return () => window.clearInterval(timer);
  }, [heroSlides.length]);

  return <div className="stack">
    <section className="wallet-hero wallet-hero--mobile mobile-only" aria-label={t('widgets.wallet')}>
      <p className="wallet-hero__label">{t('widgets.wallet')}</p>
      <div className="wallet-hero__amount">
        {core.profile ? money(core.profile.balanceCents) : '—'}
        <small>RUB</small>
      </div>
      <Button
        variant="violet"
        className="wallet-hero__topup"
        onClick={() => {
          if (openTopup) openTopup();
          else switchTo('profile');
        }}
      >
        <IconWallet size={18} /> {t('widgets.addFunds')}
      </Button>
    </section>

    <section className="desktop-hero market-hero" aria-roledescription="carousel" aria-label="Промо маркета">
      <div className="market-hero__track" ref={heroTrackRef}>
        {heroSlides.map((slide, index) => (
          <article
            key={slide.id}
            className="market-hero__slide"
            aria-hidden={heroSlide !== index}
            aria-label={`${index + 1} из ${heroSlides.length}`}
          >
            <h2>{slide.title}</h2>
            <p>{slide.text}</p>
            <Button
              variant="violet"
              onClick={() => {
                if (slide.action === 'create') switchTo('create');
                else heroTrackRef.current?.closest('.stack')?.querySelector('.cat-row')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              {slide.cta}
            </Button>
          </article>
        ))}
      </div>
      <div className="desktop-hero__dots" role="tablist" aria-label="Слайды">
        {heroSlides.map((slide, index) => (
          <button
            key={slide.id}
            type="button"
            role="tab"
            aria-selected={heroSlide === index}
            className={heroSlide === index ? 'active' : undefined}
            onClick={() => goHeroSlide(index)}
            aria-label={`Слайд ${index + 1}`}
          />
        ))}
      </div>
    </section>

    <div className="cat-row" role="list" aria-label="Категории">
      <button
        type="button"
        role="listitem"
        className={`cat-card${category === 'Все' ? ' active' : ''}`}
        onClick={() => { setCategory('Все'); setSubcategory(''); }}
      >
        <span className="cat-card__emblem" style={{ background: 'linear-gradient(145deg,#8B7FF5,#6B5FE0)' }}>ALL</span>
        <span className="cat-card__name">Все</span>
        {totalVisible > 0 && <span className="cat-card__count">{formatCatCount(totalVisible)}</span>}
      </button>
      {CATEGORIES.map((cat) => {
        const style = CAT_STYLE[cat];
        const count = categoryCounts[cat] ?? 0;
        const image = CATEGORY_IMAGES[cat];
        return (
          <button
            type="button"
            role="listitem"
            key={cat}
            className={`cat-card${category === cat ? ' active' : ''}`}
            onClick={() => { setCategory(cat); setSubcategory(''); }}
          >
            {image ? (
              <span className="cat-card__emblem cat-card__emblem--photo">
                <img src={image} alt="" width={40} height={40} loading="lazy" decoding="async" />
              </span>
            ) : (
              <span
                className="cat-card__emblem"
                style={{ background: style.bg, ['--_glow' as string]: style.glow }}
              >{style.letter}</span>
            )}
            <span className="cat-card__name">{CATEGORY_LABELS[cat]}</span>
            {count > 0 && <span className="cat-card__count">{formatCatCount(count)}</span>}
          </button>
        );
      })}
    </div>

    {marketSubs.length > 0 && <div className="chips" role="list" aria-label="Подкатегории">
      {marketSubs.map(item => (
        <button
          role="listitem"
          className={subcategory === item ? 'active' : ''}
          key={item}
          onClick={() => setSubcategory(subcategory === item ? '' : item)}
        >{(SUBCATEGORY_LABELS[item] ?? item).toUpperCase()}</button>
      ))}
    </div>}

    <div className="search-row desktop-search">
      <Input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Товар, продавец или ONIX ID" aria-label="Поиск" />
      <Select value={sort} onChange={event => setSort(event.target.value)} aria-label="Сортировка">
        <option value="new">Сначала новые</option>
        <option value="price">Сначала дешевле</option>
        <option value="rating">По рейтингу</option>
      </Select>
    </div>

    {onixQuery && <Button variant="secondary" onClick={async () => {
      try {
        setSellerProfile(await api.get<PublicProfile>(API_PATHS.userPublic(onixQuery)));
      } catch (error) {
        setToast(friendlyError(error));
      }
    }}>Открыть профиль</Button>}

    {marketState === 'loading' ? <div className="product-grid"><Card><Skeleton lines={4} /></Card><Card><Skeleton lines={4} /></Card></div> :
      marketState === 'error' ? <StateView title="Витрина недоступна" text={marketError || ''} action={<Button onClick={() => void core.refreshAll()}>Попробовать снова</Button>} /> :
      items.length === 0 ? <StateView title="Ничего не найдено" text="Измените запрос или фильтры. Можно разместить собственный лот." action={<Button onClick={() => switchTo('create')}>Разместить лот</Button>} /> :
      <div className="product-grid product-grid--compact">{items.map(product => {
        const rating = product.seller.rating.toFixed(1);
        const showFounder = product.seller.badge === 'SUPER_ADMIN';
        return (
          <Card key={product.id} interactive className="product-card product-card--compact">
            <div className="product-card__media">
              <button
                type="button"
                className="product-card__media-hit"
                onClick={() => void openProduct(product)}
                aria-label={`Открыть ${product.title}`}
              />
              <div className="product-card__badges">
                <span className="pill-rating"><IconStar /> {rating}</span>
                {showFounder && <span className="pill-super">Основатель</span>}
              </div>
              <div className="product-card__avatar">
                <UserAvatar
                  avatarUrl={product.seller.avatarUrl}
                  name={product.seller.username}
                  size="medium"
                  online={sellerIsPresent(product.seller, core.profile)}
                />
              </div>
              <button
                type="button"
                className={`favorite ${product.favorite ? 'active' : ''}`}
                onClick={() => {
                  setItems(previous => previous.map(item => item.id === product.id ? { ...item, favorite: !item.favorite } : item));
                  void core.toggleFavorite(product);
                }}
                aria-label={product.favorite ? 'Убрать из избранного' : 'В избранное'}
              >♥</button>
            </div>
            <button type="button" className="product-main product-main--body" onClick={() => void openProduct(product)} aria-label={`Открыть ${product.title}`}>
              <div className="product-card__body">
                <h2>{product.title.length > 36 ? `${product.title.slice(0, 36)}…` : product.title}</h2>
                <p className="product-card__meta">
                  {CATEGORY_LABELS[product.category as keyof typeof CATEGORY_LABELS] ?? product.category}
                  {lotLabel(product) ? ` · ${lotLabel(product)}` : ''}
                </p>
              </div>
            </button>
            <div className="product-card__footer product-card__footer--bar">
              <strong className="product-card__price">{money(product.priceCents)}</strong>
              <button type="button" className="button button--buy product-card__buy" onClick={() => setConfirm(product)}>Купить</button>
            </div>
          </Card>
        );
      })}</div>}
    {marketState === 'success' && hasMore && (
      <Button variant="secondary" busy={loadingMore} onClick={() => void loadMore()}>Показать ещё</Button>
    )}
    <Modal open={Boolean(selected)} title={selected?.title || ''} onClose={() => { setSelected(null); setSellerTrust(null); setDetailReady(false); }}>
      {selected && <div className="stack compact">
        <div className="product-detail">
          <strong>{money(selected.priceCents)}</strong>
          {lotLabel(selected) && <span className="onixlot-id">{lotLabel(selected)}</span>}
        </div>
        <p className="muted">
          {!detailReady
            ? 'Загрузка описания…'
            : (selected.description?.trim() || 'Продавец не добавил описание.')}
        </p>
        {sellerTrust && (
          <div className="trust-strip">
            <span><b>Уровень {sellerTrust.level}</b></span>
            <span><b>{money(sellerTrust.depositTotal)}</b> залог</span>
            {sellerTrust.phoneVerified && <span>Телефон</span>}
            {sellerTrust.passportVerified && <span>Паспорт</span>}
            {sellerTrust.voiceVerified && <span>Голос</span>}
          </div>
        )}
        <Card><div className="seller-row"><div className="user-summary"><UserAvatar avatarUrl={selected.seller.avatarUrl} name={selected.seller.username} online={sellerIsPresent(selected.seller, core.profile)} /><div><b>{publicAt(selected.seller.username)} <StaffBadge badge={selected.seller.badge} /></b><p className="muted">{formatOnixId(selected.seller.onixId)} · {selected.seller.salesCount} сделок · {selected.seller.reviewCount} отзывов · {selected.seller.followersCount} подписчиков · {sellerIsPresent(selected.seller, core.profile) ? 'Online' : formatLastSeen(selected.seller.lastOnline)}</p></div></div><span>★ {selected.seller.rating.toFixed(1)}</span></div>
          <div className="card-actions">
            <Button type="button" variant="secondary" onClick={async () => {
              const onixId = selected.seller.onixId;
              // Close lot sheet first so profile modal is never buried under it.
              setSelected(null);
              setSellerTrust(null);
              setDetailReady(false);
              try {
                setSellerProfile(await api.get<PublicProfile>(API_PATHS.userPublic(onixId)));
              } catch (error) {
                setToast(friendlyError(error));
              }
            }}>Профиль продавца</Button>
            <Button
              variant="secondary"
              busy={core.actionBusy === `follow-${selected.seller.onixId}`}
              onClick={() => {
                const wasFollowed = Boolean(selected.seller.followed);
                const delta = wasFollowed ? -1 : 1;
                setSelected((prev) => (prev ? {
                  ...prev,
                  seller: {
                    ...prev.seller,
                    followed: !wasFollowed,
                    followersCount: Math.max(0, prev.seller.followersCount + delta),
                  },
                } : prev));
                setItems((previous) => previous.map((item) => (
                  item.seller.onixId === selected.seller.onixId
                    ? {
                      ...item,
                      seller: {
                        ...item.seller,
                        followed: !wasFollowed,
                        followersCount: Math.max(0, item.seller.followersCount + delta),
                      },
                    }
                    : item
                )));
                void core.toggleFollow(selected.seller.onixId, wasFollowed);
              }}
            >{selected.seller.followed ? 'Отписаться' : '+ Подписаться'}</Button>
          </div></Card>
        <div className="modal__actions">
          {isAdmin && (
            <Button variant="danger" busy={core.actionBusy === `admin-del-${selected.id}`} onClick={async () => {
              try {
                await api.delete(API_PATHS.adminProductRemove(selected.id));
                setItems((prev) => prev.filter((p) => p.id !== selected.id));
                setSelected(null);
                setToast('Объявление удалено админом.');
              } catch (error) {
                setToast(friendlyError(error));
              }
            }}>Удалить</Button>
          )}
          <Button variant="secondary" onClick={async () => {
          setSelected(null);
          await openDirectChat(selected.seller.onixId);
        }}>Написать</Button><Button variant="buy" disabled={selected.status !== 'ACTIVE'} onClick={() => setConfirm(selected)}>Купить</Button></div>
      </div>}
    </Modal>
    <PublicProfileModal
      profile={sellerProfile}
      onClose={() => setSellerProfile(null)}
      core={core}
      onOpenOnix={async (onixId) => {
        try {
          setSellerProfile(await api.get<PublicProfile>(API_PATHS.userPublic(onixId)));
        } catch (error) {
          setToast(friendlyError(error));
        }
      }}
      onWrite={async (onixId) => {
        setSellerProfile(null);
        setSelected(null);
        await openDirectChat(onixId);
      }}
      onOpenProduct={(productId) => {
        setSellerProfile(null);
        setSelected(null);
        openProductCard(productId);
      }}
      setToast={setToast}
    />
    <Confirm open={Boolean(confirm)} title="Подтвердите покупку" text={confirm ? `${money(confirm.priceCents)} будут безопасно заморожены до получения товара.` : ''} busy={core.actionBusy?.startsWith('purchase')} onCancel={() => setConfirm(null)}
      onConfirm={async () => {
        if (!confirm) return;
        const deal = await core.purchase(confirm.id);
        if (!deal) return;
        setConfirm(null);
        setSelected(null);
        setToast('Сделка создана. Деньги в сейфе.');
        if (deal.chatId) openDealChat(deal.chatId);
        else switchTo('deals');
      }} />
  </div>;
}
export default Market;
