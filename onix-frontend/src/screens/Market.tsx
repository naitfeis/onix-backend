import { useEffect, useRef, useState } from 'react';
import { api, money, friendlyError } from '../api/client';
import {
  API_PATHS, CATEGORIES, CATEGORY_LABELS, SUBCATEGORIES_BY_CATEGORY, SUBCATEGORY_LABELS,
  formatLastSeen, sellerIsPresent, type Product, type PublicProfile, type TrustCard,
} from '../api/contracts';
import UserAvatar from '../components/UserAvatar';
import { IconStar } from '../components/NavIcons';
import { Button, Card, Confirm, Input, Modal, Select, Skeleton, StateView } from '../design-system';
import { formatOnixId } from '../utils/onixId';
import { publicAt } from '../utils/publicAt';
import { CATEGORY_IMAGES } from '../utils/categoryImages';
import { matchCategorySearch } from '../utils/matchCategorySearch';
import type { Core, Screen } from './types';
import { PublicProfileModal, StaffBadge } from './shared';

const CAT_STYLE: Record<string, { bg: string; glow: string; letter: string }> = {
  STANDOFF_2: { bg: 'linear-gradient(145deg,#E8B93E,#C4982E)', glow: 'rgba(232,185,62,.35)', letter: 'S2' },
  STEAM: { bg: 'linear-gradient(145deg,#4A8FE0,#346FB8)', glow: 'rgba(74,143,224,.32)', letter: 'ST' },
  ROBLOX: { bg: 'linear-gradient(145deg,#5B8DEF,#3D6FD4)', glow: 'rgba(91,141,239,.32)', letter: 'RB' },
  RP_PROJECTS: { bg: 'linear-gradient(145deg,#8B7FF5,#6B5FE0)', glow: 'rgba(139,127,245,.32)', letter: 'RP' },
  BRAWL_STARS: { bg: 'linear-gradient(145deg,#E8934A,#C47535)', glow: 'rgba(232,147,74,.32)', letter: 'BS' },
  CS2: { bg: 'linear-gradient(145deg,#F08A2E,#C45A1A)', glow: 'rgba(240,138,46,.35)', letter: 'CS' },
  FORTNITE: { bg: 'linear-gradient(145deg,#6EC8FF,#3B8FE0)', glow: 'rgba(110,200,255,.32)', letter: 'FN' },
  VALORANT: { bg: 'linear-gradient(145deg,#FF4655,#C43A45)', glow: 'rgba(255,70,85,.32)', letter: 'VA' },
  GTA_5: { bg: 'linear-gradient(145deg,#4CAF50,#2E7D32)', glow: 'rgba(76,175,80,.32)', letter: 'V' },
  GTA_6: { bg: 'linear-gradient(145deg,#E91E8C,#7B2CBF)', glow: 'rgba(233,30,140,.32)', letter: 'VI' },
  DOTA_2: { bg: 'linear-gradient(145deg,#C23B2F,#8B1E18)', glow: 'rgba(194,59,47,.35)', letter: 'D2' },
  PUBG_MOBILE: { bg: 'linear-gradient(145deg,#F5A623,#E85D04)', glow: 'rgba(245,166,35,.32)', letter: 'PG' },
  GENSHIN: { bg: 'linear-gradient(145deg,#4FC3F7,#1A73A8)', glow: 'rgba(79,195,247,.32)', letter: 'GI' },
  MOBILE_LEGENDS: { bg: 'linear-gradient(145deg,#2D3436,#636E72)', glow: 'rgba(45,52,54,.28)', letter: 'ML' },
  APP_STORE: { bg: 'linear-gradient(145deg,#2F7CF6,#1A56C8)', glow: 'rgba(47,124,246,.32)', letter: 'AS' },
  PUBG: { bg: 'linear-gradient(145deg,#2C2C2C,#111111)', glow: 'rgba(0,0,0,.28)', letter: 'PG' },
  MINECRAFT: { bg: 'linear-gradient(145deg,#5D9C3D,#3E6B28)', glow: 'rgba(93,156,61,.32)', letter: 'MC' },
  PLAYSTATION: { bg: 'linear-gradient(145deg,#0070D1,#003B8E)', glow: 'rgba(0,112,209,.32)', letter: 'PS' },
  STALCRAFT: { bg: 'linear-gradient(145deg,#3A5F8A,#1E3348)', glow: 'rgba(58,95,138,.32)', letter: 'SC' },
  PATH_OF_EXILE_2: { bg: 'linear-gradient(145deg,#8B1E1E,#3D0F0F)', glow: 'rgba(139,30,30,.32)', letter: 'PE' },
  OTHER: { bg: 'linear-gradient(145deg,#8A8B96,#63646E)', glow: 'rgba(138,139,150,.28)', letter: '··' },
};

function formatCatCount(n: number): string {
  if (n <= 0) return '';
  if (n > 99) return '99+';
  return String(n);
}

export function Market({
  core, switchTo, setToast, focusProductId, onFocusProductHandled, openDirectChat, openProductCard, openDealChat,
  externalCategory, onExternalCategoryConsumed,
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
  const [catVisibleCount, setCatVisibleCount] = useState(9);
  const [catScroll, setCatScroll] = useState({ max: 0, value: 0 });
  const heroTrackRef = useRef<HTMLDivElement>(null);
  const catRowRef = useRef<HTMLDivElement>(null);
  const PAGE = 15;
  /** Categories revealed per «Показать ещё» (under «Все»). */
  const CAT_PAGE_SIZE = 9;
  const visibleCats = CATEGORIES.slice(0, catVisibleCount);
  const hiddenCatCount = CATEGORIES.length - catVisibleCount;
  const catsFullyOpen = hiddenCatCount <= 0;
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
    const idx = CATEGORIES.indexOf(externalCategory as typeof CATEGORIES[number]);
    if (idx >= 0) {
      setCatVisibleCount((n) => Math.max(n, Math.min(CATEGORIES.length, idx + 1)));
    }
    onExternalCategoryConsumed?.();
  }, [externalCategory, onExternalCategoryConsumed]);

  useEffect(() => {
    const el = catRowRef.current;
    if (!el) return;
    const sync = () => {
      const max = Math.max(0, el.scrollWidth - el.clientWidth);
      setCatScroll({ max, value: Math.min(el.scrollLeft, max) });
    };
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null;
    ro?.observe(el);
    window.addEventListener('resize', sync);
    return () => {
      el.removeEventListener('scroll', sync);
      ro?.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [visibleCats.length]);

  useEffect(() => {
    const isDefaultBrowse =
      category === 'Все' && !subcategory && !query.trim() && sort === 'new';

    // Default home feed: reuse bootstrap catalog — do not fire a second /api/products
    // with AbortSignal (that disables GET dedupe and can hit the 15s timeout alone).
    if (isDefaultBrowse) {
      if (core.states.products === 'success') {
        setItems(core.products);
        setHasMore(core.products.length >= PAGE);
        setMarketError(undefined);
        setMarketState('success');
        setOffset(0);
        return;
      }
      if (core.states.products === 'loading' || core.states.products === 'idle') {
        setMarketState((prev) => (prev === 'success' ? prev : 'loading'));
        return;
      }
      // products === 'error' → fall through to one recoverable fetch
    }

    const controller = new AbortController();
    const debounceMs = query.trim() ? 300 : 0;
    const timer = window.setTimeout(() => {
      setMarketState('loading');
      setOffset(0);
      const serverSort = sort === 'price' ? 'price_asc' as const : sort === 'rating' ? 'rating' as const : 'newest' as const;
      const q = query.trim();
      const searchCat = category === 'Все' ? matchCategorySearch(q) : undefined;
      void core.listProducts({
        // Exact category name → filter by category (all lots in that game).
        // Otherwise keep free-text title/seller search.
        search: searchCat ? undefined : (q || undefined),
        category: category === 'Все' ? searchCat : category,
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
  }, [category, core.listProducts, core.products, core.states.products, query, sort, subcategory]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const next = offset + PAGE;
    const serverSort = sort === 'price' ? 'price_asc' as const : sort === 'rating' ? 'rating' as const : 'newest' as const;
    try {
      const q = query.trim();
      const searchCat = category === 'Все' ? matchCategorySearch(q) : undefined;
      const data = await core.listProducts({
        search: searchCat ? undefined : (q || undefined),
        category: category === 'Все' ? searchCat : category,
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

    <div className="cat-block">
      {catScroll.max > 0 && (
        <input
          type="range"
          className="cat-scroll-slider mobile-only"
          min={0}
          max={catScroll.max}
          step={1}
          value={catScroll.value}
          aria-label="Прокрутка категорий"
          onChange={(event) => {
            const next = Number(event.target.value);
            const row = catRowRef.current;
            if (row) row.scrollLeft = next;
            setCatScroll((prev) => ({ ...prev, value: next }));
          }}
        />
      )}
      <div
        className="cat-row"
        role="list"
        aria-label="Категории"
        ref={catRowRef}
      >
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
        {visibleCats.map((cat) => {
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
                  <img
                    src={image}
                    alt=""
                    width={40}
                    height={40}
                    loading="lazy"
                    decoding="async"
                    fetchPriority="low"
                  />
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
      {CATEGORIES.length > CAT_PAGE_SIZE && (
        <button
          type="button"
          className="cat-more"
          aria-expanded={catsFullyOpen || catVisibleCount > CAT_PAGE_SIZE}
          onClick={() => {
            if (catsFullyOpen) {
              const collapsing = CATEGORIES.slice(CAT_PAGE_SIZE);
              if (category !== 'Все' && collapsing.includes(category as typeof CATEGORIES[number])) {
                setCategory('Все');
                setSubcategory('');
              }
              setCatVisibleCount(CAT_PAGE_SIZE);
              return;
            }
            setCatVisibleCount((n) => Math.min(CATEGORIES.length, n + CAT_PAGE_SIZE));
          }}
        >
          {catsFullyOpen
            ? 'Скрыть'
            : `Показать ещё (${Math.min(CAT_PAGE_SIZE, hiddenCatCount)})`}
        </button>
      )}
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
                  userId={product.seller.id}
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
        <Card><div className="seller-row"><div className="user-summary"><UserAvatar userId={selected.seller.id} avatarUrl={selected.seller.avatarUrl} name={selected.seller.username} online={sellerIsPresent(selected.seller, core.profile)} /><div><b>{publicAt(selected.seller.username)} <StaffBadge badge={selected.seller.badge} /></b><p className="muted">{formatOnixId(selected.seller.onixId)} · {selected.seller.salesCount} сделок · {selected.seller.reviewCount} отзывов · {selected.seller.followersCount} подписчиков · {sellerIsPresent(selected.seller, core.profile) ? 'Online' : formatLastSeen(selected.seller.lastOnline)}</p></div></div><span>★ {selected.seller.rating.toFixed(1)}</span></div>
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
