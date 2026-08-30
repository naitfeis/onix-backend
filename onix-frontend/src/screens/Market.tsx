import { useEffect, useRef, useState } from 'react';
import { api, money, friendlyError } from '../api/client';
import {
  API_PATHS, CATEGORIES, CATEGORY_LABELS, SUBCATEGORIES_BY_CATEGORY, SUBCATEGORY_LABELS,
  formatLastSeen, sellerIsPresent, type Product, type PublicProfile, type TrustCard,
} from '../api/contracts';
import UserAvatar from '../components/UserAvatar';
import { IconStar } from '../components/NavIcons';
import { Button, Card, Confirm, Input, Modal, Skeleton, StateView } from '../design-system';
import { formatOnixId } from '../utils/onixId';
import { publicAt } from '../utils/publicAt';
import { CATEGORY_IMAGES } from '../utils/categoryImages';
import { matchCategorySearch } from '../utils/matchCategorySearch';
import type { Core, Screen } from './types';
import { PublicProfileModal, StaffBadge } from './shared';
import { getRealtimeClient } from '../realtime/client';
import { t } from '../i18n';

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

const SORT_OPTIONS = [
  { value: 'new', label: 'Сначала новые', server: 'newest' as const },
  { value: 'price', label: 'Сначала дешевле', server: 'price_asc' as const },
  { value: 'price_desc', label: 'Сначала дороже', server: 'price_desc' as const },
] as const;

function toServerSort(sort: string) {
  return SORT_OPTIONS.find((o) => o.value === sort)?.server ?? 'newest';
}

function formatCatCount(n: number): string {
  if (n <= 0) return '';
  if (n > 99) return '99+';
  return String(n);
}

function reviewCountLabel(n: number): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return `${n} отзывов`;
  if (last === 1) return `${n} отзыв`;
  if (last >= 2 && last <= 4) return `${n} отзыва`;
  return `${n} отзывов`;
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
  const [category, setCategory] = useState(t('market.all'));
  const [subcategory, setSubcategory] = useState('');
  const [sort, setSort] = useState('new');
  const [sortOpen, setSortOpen] = useState(false);
  const [items, setItems] = useState<Product[]>([]);
  const [marketState, setMarketState] = useState<'loading' | 'success' | 'error'>('loading');
  const [marketError, setMarketError] = useState<string | undefined>();
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sellerTrust, setSellerTrust] = useState<TrustCard | null>(null);
  const [detailReady, setDetailReady] = useState(false);
  const [heroSlide, setHeroSlide] = useState(0);
  const [catVisibleCount, setCatVisibleCount] = useState(11);
  const [catScroll, setCatScroll] = useState({ max: 0, value: 0 });
  const heroTrackRef = useRef<HTMLDivElement>(null);
  const catRowRef = useRef<HTMLDivElement>(null);
  const PAGE = 15;
  /** ALL + 11 categories = 12 tiles → 4×3 on desktop, 3×4 on mobile. */
  const CAT_PAGE_SIZE = 11;
  const catsFullyOpen = catVisibleCount >= CATEGORIES.length;
  const visibleCats = catsFullyOpen ? CATEGORIES : CATEGORIES.slice(0, CAT_PAGE_SIZE);
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

  /** One view ping per product per browser tab — kills StrictMode/focus re-open spam → 429. */
  const viewedIdsRef = useRef<Set<string>>(new Set());

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
      if (core.profile && !viewedIdsRef.current.has(full.id)) {
        viewedIdsRef.current.add(full.id);
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
  const onixLotMatch = query.trim().match(/^ONIXLOT-(\d+)$/i);
  const onixLotNumber = onixLotMatch ? Number(onixLotMatch[1]) : null;
  const catalog = core.catalogSubcategories ?? SUBCATEGORIES_BY_CATEGORY;
  const marketSubs = category !== t('market.all')
    ? (catalog[category as typeof CATEGORIES[number]] ?? SUBCATEGORIES_BY_CATEGORY[category as typeof CATEGORIES[number]] ?? [])
    : [];

  useEffect(() => {
    if (!externalCategory || externalCategory === t('market.all')) return;
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
      category === t('market.all') && !subcategory && !query.trim() && sort === 'new';

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
      const q = query.trim();
        const searchCat = category === t('market.all') ? matchCategorySearch(q) : undefined;
      void core.listProducts({
        // Exact category name → filter by category (all lots in that game).
        // Otherwise keep free-text title/seller search.
        search: searchCat ? undefined : (q || undefined),
        category: category === t('market.all') ? searchCat : category,
        subcategory: subcategory || undefined,
        sort: toServerSort(sort),
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
    try {
      const q = query.trim();
      const searchCat = category === t('market.all') ? matchCategorySearch(q) : undefined;
      const data = await core.listProducts({
        search: searchCat ? undefined : (q || undefined),
        category: category === t('market.all') ? searchCat : category,
        subcategory: subcategory || undefined,
        sort: toServerSort(sort),
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

  // Live market: stock/status + soft sellers from presence map (re-render via core.presenceByOnixId).
  useEffect(() => {
    const off = getRealtimeClient().onMessage((msg) => {
      if (msg.type !== 'product.changed') return;
      if (msg.status !== 'ACTIVE') {
        setItems((prev) => prev.filter((p) => p.id !== msg.productId));
        setSelected((prev) => (prev?.id === msg.productId ? null : prev));
        return;
      }
      setItems((prev) => prev.map((p) => (
        p.id === msg.productId ? { ...p, status: msg.status as Product['status'], quantity: msg.quantity } : p
      )));
      if (msg.created) {
        // New listing — pull first page for current browse filters.
        void core.listProducts({ limit: 15, offset: 0 }).then((data) => {
          if (Array.isArray(data) && data.length) setItems(data);
        }).catch(() => { /* ignore */ });
      }
    });
    return () => { off(); };
  }, [core.listProducts]);

  // Re-apply presence timestamps onto visible cards when WS presence arrives.
  useEffect(() => {
    const entries = Object.entries(core.presenceByOnixId);
    if (!entries.length) return;
    setItems((prev) => prev.map((product) => {
      const live = core.presenceOf(product.seller.onixId);
      if (!live || product.seller.lastOnline === live.lastOnline) return product;
      return { ...product, seller: { ...product.seller, lastOnline: live.lastOnline } };
    }));
  }, [core.presenceByOnixId, core.presenceOf]);

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
    const width = track.clientWidth || 1;
    track.scrollTo({ left: next * width, behavior: 'smooth' });
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
          const width = track.clientWidth || 1;
          track.scrollTo({ left: next * width, behavior: 'smooth' });
        }
        return next;
      });
    }, 10_000);
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
        aria-label={t('market.categories')}
        ref={catRowRef}
      >
        <button
          type="button"
          role="listitem"
          className={`cat-card${category === t('market.all') ? ' active' : ''}`}
          onClick={() => { setCategory(t('market.all')); setSubcategory(''); }}
        >
          <span className="cat-card__icon">
            <span className="cat-card__emblem" style={{ background: 'linear-gradient(145deg,#8B7FF5,#6B5FE0)' }}>ALL</span>
            {totalVisible > 0 && <span className="cat-card__count">{formatCatCount(totalVisible)}</span>}
          </span>
          <span className="cat-card__name">{t('market.all')}</span>
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
              <span className="cat-card__icon">
                {image ? (
                  <span className="cat-card__emblem cat-card__emblem--photo">
                    <img
                      src={image}
                      alt=""
                      width={44}
                      height={44}
                      loading="lazy"
                      decoding="async"
                      fetchPriority="low"
                    />
                  </span>
                ) : (
                  <span
                    className="cat-card__emblem"
                    style={{ background: style.bg }}
                  >{style.letter}</span>
                )}
                {count > 0 && <span className="cat-card__count">{formatCatCount(count)}</span>}
              </span>
              <span className="cat-card__name">{CATEGORY_LABELS[cat]}</span>
            </button>
          );
        })}
      </div>
      {CATEGORIES.length > CAT_PAGE_SIZE && (
        <button
          type="button"
          className="cat-more"
          aria-expanded={catsFullyOpen}
          onClick={() => {
            if (catsFullyOpen) {
              const collapsing = CATEGORIES.slice(CAT_PAGE_SIZE);
              if (category !== t('market.all') && collapsing.includes(category as typeof CATEGORIES[number])) {
                setCategory(t('market.all'));
                setSubcategory('');
              }
              setCatVisibleCount(CAT_PAGE_SIZE);
              return;
            }
            setCatVisibleCount(CATEGORIES.length);
          }}
        >
          {catsFullyOpen ? 'Скрыть' : 'Показать всё'}
        </button>
      )}
    </div>

    <div className="search-row desktop-search">
      <Input
        type="search"
        value={query}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          const matched = matchCategorySearch(next);
          if (matched) {
            setCategory(matched);
            setSubcategory('');
            setCatVisibleCount(CATEGORIES.length);
          }
        }}
        placeholder={t('market.search')}
        aria-label={t('market.searchAria')}
      />
      <div className="sort-picker">
        <button
          type="button"
          className={`control category-toggle${sortOpen ? ' is-open' : ''}`}
          aria-expanded={sortOpen}
          aria-controls="market-sort-list"
          aria-label="Сортировка"
          onClick={() => setSortOpen((open) => !open)}
        >
          <span>{SORT_OPTIONS.find((o) => o.value === sort)?.label ?? 'Сначала новые'}</span>
        </button>
        {sortOpen && (
          <div id="market-sort-list" className="chips category-picker sort-picker__list" role="list" aria-label="Варианты сортировки">
            {SORT_OPTIONS.map((item) => (
              <button
                type="button"
                role="listitem"
                key={item.value}
                className={sort === item.value ? 'active' : ''}
                onClick={() => {
                  setSort(item.value);
                  setSortOpen(false);
                }}
              >{item.label}</button>
            ))}
          </div>
        )}
      </div>
    </div>

    {marketSubs.length > 0 && (
      <div className="chips market-subchips" role="list" aria-label="Подкатегории">
        {marketSubs.map((item) => (
          <button
            type="button"
            role="listitem"
            className={subcategory === item ? 'active' : ''}
            key={item}
            onClick={() => setSubcategory(subcategory === item ? '' : item)}
          >{(SUBCATEGORY_LABELS[item] ?? item).toUpperCase()}</button>
        ))}
      </div>
    )}

    {onixLotNumber != null && Number.isFinite(onixLotNumber) && (
      <Button
        variant="secondary"
        onClick={async () => {
          try {
            const product = await api.get<Product>(API_PATHS.productByLot(onixLotNumber));
            await openProduct(product);
          } catch (error) {
            setToast(friendlyError(error));
          }
        }}
      >Открыть лот {`ONIXLOT-${onixLotNumber}`}</Button>
    )}

    {onixQuery && <Button variant="secondary" onClick={async () => {
      try {
        setSellerProfile(await api.get<PublicProfile>(API_PATHS.userPublic(onixQuery)));
      } catch (error) {
        setToast(friendlyError(error));
      }
    }}>Открыть профиль</Button>}

    {marketState === 'loading' ? <div className="product-grid"><Card><Skeleton lines={4} /></Card><Card><Skeleton lines={4} /></Card></div> :
      marketState === 'error' ? <StateView title={t('market.unavailable')} text={marketError || ''} action={<Button onClick={() => void core.refreshAll()}>{t('common.retry')}</Button>} /> :
      items.length === 0 ? <StateView title={t('market.emptyTitle')} text={t('market.emptyText')} action={<Button onClick={() => switchTo('create')}>Разместить лот</Button>} /> :
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
                <div className="product-card__rating">
                  <span className="product-card__rating-score"><IconStar /> {rating}</span>
                  <span className="product-card__rating-count">{reviewCountLabel(product.seller.reviewCount)}</span>
                </div>
                {showFounder && <span className="pill-super">Основатель</span>}
              </div>
              <div className="product-card__seller-float">
                <div className="product-card__avatar">
                <UserAvatar
                  userId={product.seller.id}
                  avatarUrl={product.seller.avatarUrl}
                  name={product.seller.username}
                  size="medium"
                  online={sellerIsPresent(product.seller, core.profile, core.presenceOf(product.seller.onixId))}
                />
                </div>
                <span title={product.seller.username}>{publicAt(product.seller.username)}</span>
              </div>
              <button
                type="button"
                className={`favorite ${product.favorite ? 'active' : ''}`}
                onClick={() => {
                  setItems(previous => previous.map(item => item.id === product.id ? { ...item, favorite: !item.favorite } : item));
                  void core.toggleFavorite(product);
                }}
                aria-label={product.favorite ? t('market.favoriteRemove') : t('market.favoriteAdd')}
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
              <button type="button" className="button button--buy product-card__buy" onClick={() => setConfirm(product)}>{t('market.buy')}</button>
            </div>
          </Card>
        );
      })}</div>}
    {marketState === 'success' && hasMore && (
      <Button variant="secondary" busy={loadingMore} onClick={() => void loadMore()}>{t('common.showMore')}</Button>
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
          </div>
        )}
        <Card><div className="seller-row"><div className="user-summary"><UserAvatar userId={selected.seller.id} avatarUrl={selected.seller.avatarUrl} name={selected.seller.username} online={sellerIsPresent(selected.seller, core.profile, core.presenceOf(selected.seller.onixId))} /><div><b>{publicAt(selected.seller.username)} <StaffBadge badge={selected.seller.badge} /></b><p className="muted">{formatOnixId(selected.seller.onixId)} · {selected.seller.salesCount} сделок · {selected.seller.reviewCount} отзывов · {selected.seller.followersCount} подписчиков · {sellerIsPresent(selected.seller, core.profile, core.presenceOf(selected.seller.onixId)) ? 'Online' : formatLastSeen(core.presenceOf(selected.seller.onixId)?.lastOnline ?? selected.seller.lastOnline)}</p></div></div><span>★ {selected.seller.rating.toFixed(1)}</span></div>
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
