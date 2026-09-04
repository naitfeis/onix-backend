import { useEffect, useMemo, useRef, useState } from 'react';
import { api, friendlyError } from '../api/client';
import {
  API_PATHS, CATEGORIES, SUBCATEGORIES_BY_CATEGORY, SUBCATEGORY_LABELS,
  type Product, type PublicProfile, type TrustCard,
} from '../api/contracts';
import { Button, Card, Input, Skeleton, StateView } from '../design-system';
import { LotSheet } from './LotSheet';
import { ProductLotCard } from './ProductLotCard';
import { publicAt } from '../utils/publicAt';
import { CATEGORY_IMAGES } from '../utils/categoryImages';
import { matchCategorySearch } from '../utils/matchCategorySearch';
import type { Core, Screen } from './types';
import { PublicProfileModal } from './shared';
import { getRealtimeClient } from '../realtime/client';
import { t, categoryLabel, isMarketAllCategory, MARKET_ALL_CATEGORY } from '../i18n';
import { hideCatalogProduct, isCatalogHidden, visibleProducts } from '../catalogVisibility';
import { AllGridIcon } from '../components/BrandLogos';

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
  { value: 'rating', label: 'По отзывам', server: 'rating' as const },
  { value: 'warranty', label: 'По сроку гарантии', server: 'warranty' as const },
] as const;

function catalogScroller(): HTMLElement | Window {
  return (document.querySelector('.app-main') as HTMLElement | null) ?? window;
}

function readCatalogScroll(): number {
  const el = catalogScroller();
  return el === window ? window.scrollY : (el as HTMLElement).scrollTop;
}

function writeCatalogScroll(top: number) {
  const el = catalogScroller();
  if (el === window) window.scrollTo({ top });
  else (el as HTMLElement).scrollTo({ top });
}

function toServerSort(sort: string) {
  return SORT_OPTIONS.find((o) => o.value === sort)?.server ?? 'newest';
}

function catalogBackLabel(category: string, subcategory: string): string {
  if (isMarketAllCategory(category)) return t('market.backAll');
  const cat = categoryLabel(category);
  const sub = subcategory ? (SUBCATEGORY_LABELS[subcategory] ?? subcategory) : '';
  return sub ? `Назад в ${cat} · ${sub}` : `Назад в ${cat}`;
}

function CategoryShareRing({ count, total }: { count: number; total: number }) {
  const shown = count > 99 ? '99+' : String(count);
  const fraction = total > 0 ? Math.min(1, Math.max(0, count / total)) : 0;
  const size = 28;
  const stroke = 2.75;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <span className="cat-card__ring" aria-label={`${count} лотов`}>
      <svg className="cat-card__ring-svg" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          className="cat-card__ring-track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
        />
        <circle
          className="cat-card__ring-value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          opacity={fraction > 0 ? 1 : 0}
        />
      </svg>
      <span className="cat-card__ring-num">{shown}</span>
    </span>
  );
}

const VIEWED_LOTS_KEY = 'onix-viewed-lots';
function readViewedLots(): Set<string> {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(VIEWED_LOTS_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}
function rememberViewedLot(id: string, store: Set<string>) {
  store.add(id);
  try {
    sessionStorage.setItem(VIEWED_LOTS_KEY, JSON.stringify([...store].slice(-200)));
  } catch { /* ignore */ }
}

export function Market({
  core, switchTo, setToast, focusProductId, onFocusProductHandled, openDirectChat, openDealChat,
  externalCategory, onExternalCategoryConsumed,
}: {
  core: Core;
  switchTo: (screen: Screen) => void;
  setToast: (text: string) => void;
  focusProductId: string | null;
  onFocusProductHandled: () => void;
  openDirectChat: (onixId: string) => Promise<boolean>;
  openProductCard?: (productId: string) => void;
  openDealChat: (chatId: string) => void;
  externalCategory?: string;
  onExternalCategoryConsumed?: () => void;
}) {
  const [selected, setSelected] = useState<Product | null>(null);
  const [lotOrigin, setLotOrigin] = useState<'catalog' | 'profile'>('catalog');
  const [showTop, setShowTop] = useState(false);
  const catalogScrollRef = useRef(0);
  const profileReturnRef = useRef<PublicProfile | null>(null);
  const [sellerProfile, setSellerProfile] = useState<PublicProfile | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(MARKET_ALL_CATEGORY);
  const [subcategory, setSubcategory] = useState('');
  const [sort, setSort] = useState('new');
  const [sortOpen, setSortOpen] = useState(false);
  const [autoDeliverOnly, setAutoDeliverOnly] = useState(false);
  const [items, setItems] = useState<Product[]>([]);
  const [marketState, setMarketState] = useState<'loading' | 'success' | 'error'>('loading');
  const [marketError, setMarketError] = useState<string | undefined>();
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sellerTrust, setSellerTrust] = useState<TrustCard | null>(null);
  const [detailReady, setDetailReady] = useState(false);
  const [heroSlide, setHeroSlide] = useState(0);
  const [catScroll, setCatScroll] = useState({ max: 0, value: 0 });
  const heroTrackRef = useRef<HTMLDivElement>(null);
  const catRowRef = useRef<HTMLDivElement>(null);
  const PAGE = 15;
  const visibleCats = CATEGORIES;
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

  const viewedIdsRef = useRef<Set<string>>(readViewedLots());

  const openProduct = async (product: Product, origin: 'catalog' | 'profile' = 'catalog') => {
    if (origin === 'catalog') {
      catalogScrollRef.current = readCatalogScroll();
    } else {
      profileReturnRef.current = sellerProfile;
    }
    setLotOrigin(origin);
    setSelected(product);
    setDetailReady(false);
    requestAnimationFrame(() => writeCatalogScroll(0));
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
      if (!viewedIdsRef.current.has(full.id)) {
        rememberViewedLot(full.id, viewedIdsRef.current);
      }
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
  const onixLotMatch = query.trim().match(/^ONIXLOT-(\d+)$/i);
  const onixLotNumber = onixLotMatch ? Number(onixLotMatch[1]) : null;
  const catalog = core.catalogSubcategories ?? SUBCATEGORIES_BY_CATEGORY;
  const marketSubs = !isMarketAllCategory(category)
    ? (catalog[category as typeof CATEGORIES[number]] ?? SUBCATEGORIES_BY_CATEGORY[category as typeof CATEGORIES[number]] ?? [])
    : [];

  useEffect(() => {
    if (!externalCategory || isMarketAllCategory(externalCategory)) return;
    setCategory(externalCategory);
    setSubcategory('');
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
      isMarketAllCategory(category) && !subcategory && !query.trim() && sort === 'new' && !autoDeliverOnly;

    // Default home feed: reuse bootstrap catalog — do not fire a second /api/products
    // with AbortSignal (that disables GET dedupe and can hit the 15s timeout alone).
    if (isDefaultBrowse) {
      if (core.states.products === 'success') {
        const next = visibleProducts(core.products);
        setItems(next);
        setHasMore(next.length >= PAGE);
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
        const searchCat = isMarketAllCategory(category) ? matchCategorySearch(q) : undefined;
      void core.listProducts({
        // Exact category name → filter by category (all lots in that game).
        // Otherwise keep free-text title/seller search.
        search: searchCat ? undefined : (q || undefined),
        category: isMarketAllCategory(category) ? searchCat : category,
        subcategory: subcategory || undefined,
        sort: toServerSort(sort),
        autoDeliver: autoDeliverOnly || undefined,
        limit: PAGE,
        offset: 0,
      }, controller.signal).then((data) => {
        const next = visibleProducts(data);
        setItems(next);
        setHasMore(next.length >= PAGE);
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
  }, [autoDeliverOnly, category, core.listProducts, core.products, core.states.products, query, sort, subcategory]);

  const closeLot = () => {
    const origin = lotOrigin;
    setSelected(null);
    setSellerTrust(null);
    setDetailReady(false);
    if (origin === 'profile' && profileReturnRef.current) {
      setSellerProfile(profileReturnRef.current);
      return;
    }
    requestAnimationFrame(() => writeCatalogScroll(catalogScrollRef.current));
  };

  const buySelected = async (product: Product) => {
    hideCatalogProduct(product.id);
    setItems((prev) => prev.filter((p) => p.id !== product.id));
    setSelected(null);
    setSellerTrust(null);
    setDetailReady(false);
    const deal = await core.purchase(product.id);
    if (!deal) {
      // In-flight pay still owns the hide; a busy/double-click null must not restore the lot.
      if (!isCatalogHidden(product.id)) {
        setItems((prev) => {
          if (prev.some((p) => p.id === product.id)) return prev;
          return visibleProducts([product, ...prev]);
        });
        setToast('Не удалось оплатить заказ.');
      }
      return;
    }
    setToast('Сделка создана. Деньги хранятся на платформе до передачи товара.');
    if (deal.chatId) openDealChat(deal.chatId);
    else switchTo('deals');
  };

  useEffect(() => {
    const el = catalogScroller();
    const onScroll = () => {
      const top = el === window ? window.scrollY : (el as HTMLElement).scrollTop;
      setShowTop(top > 720);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const next = offset + PAGE;
    try {
      const q = query.trim();
      const searchCat = isMarketAllCategory(category) ? matchCategorySearch(q) : undefined;
      const data = await core.listProducts({
        search: searchCat ? undefined : (q || undefined),
        category: isMarketAllCategory(category) ? searchCat : category,
        subcategory: subcategory || undefined,
        sort: toServerSort(sort),
        autoDeliver: autoDeliverOnly || undefined,
        limit: PAGE,
        offset: next,
      });
      setItems((prev) => [...prev, ...visibleProducts(data)]);
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
    if (isCatalogHidden(selected.id) || selected.status !== 'ACTIVE') {
      setSelected(null);
      setSellerTrust(null);
      setDetailReady(false);
      return;
    }
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
        // New listing — pull first page for current browse filters; drop stale/hidden rows.
        void core.listProducts({ limit: 15, offset: 0 }, new AbortController().signal).then((data) => {
          if (Array.isArray(data) && data.length) setItems(visibleProducts(data));
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
          if (isCatalogHidden(fromList.id) || fromList.status !== 'ACTIVE') return;
          await openProduct(fromList);
        } else {
          const product = await api.get<Product>(`${API_PATHS.products}/${encodeURIComponent(focusProductId)}`);
          if (cancelled) return;
          if (isCatalogHidden(product.id) || product.status !== 'ACTIVE') return;
          await openProduct(product);
        }
      } catch { /* ignore */ }
      finally {
        if (!cancelled) onFocusProductHandled();
      }
    })();
    return () => { cancelled = true; };
  }, [focusProductId]);

  const categoryCounts = useMemo(() => {
    const fromApi = core.categoryLotCounts;
    const hasApi = Object.values(fromApi).some((n) => n > 0);
    if (hasApi) {
      const acc: Record<string, number> = {};
      for (const cat of CATEGORIES) acc[cat] = fromApi[cat] ?? 0;
      return acc;
    }
    const byId = new Map<string, Product>();
    for (const product of [...core.products, ...items]) byId.set(product.id, product);
    const acc: Record<string, number> = {};
    for (const cat of CATEGORIES) {
      acc[cat] = [...byId.values()].filter((p) => p.category === cat).length;
    }
    return acc;
  }, [core.categoryLotCounts, core.products, items]);
  const totalLots = useMemo(
    () => Object.values(categoryCounts).reduce((sum, n) => sum + n, 0),
    [categoryCounts],
  );

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
    {selected && (
      <LotSheet
        product={selected}
        detailReady={detailReady}
        trust={sellerTrust}
        core={core}
        buying={Boolean(core.actionBusy?.startsWith('purchase'))}
        backLabel={catalogBackLabel(category, subcategory)}
        onBack={closeLot}
        onBuy={() => buySelected(selected)}
        onToast={setToast}
        onOpenSeller={async () => {
          const onixId = selected.seller.onixId;
          try {
            setSellerProfile(await api.get<PublicProfile>(API_PATHS.userPublic(onixId)));
          } catch (error) {
            setToast(friendlyError(error));
          }
        }}
        onWrite={async () => {
          const onixId = selected.seller.onixId;
          if (core.profile?.onixId === onixId) {
            setToast('Нельзя открыть чат с собой.');
            return;
          }
          const ok = await openDirectChat(onixId);
          if (!ok) {
            setToast('Не удалось открыть чат.');
            return;
          }
          setSelected(null);
        }}
      />
    )}
    {!selected && <>
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
          className={`cat-card${isMarketAllCategory(category) ? ' active' : ''}`}
          onClick={() => { setCategory(MARKET_ALL_CATEGORY); setSubcategory(''); }}
        >
          <span className="cat-card__icon">
            <span className="cat-card__emblem cat-card__emblem--all">
              <AllGridIcon />
            </span>
            <CategoryShareRing count={totalLots} total={totalLots || 1} />
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
                {cat === 'OTHER' ? (
                  <span className="cat-card__emblem cat-card__emblem--other">
                    <span className="cat-card__dots" aria-hidden="true"><i /><i /><i /></span>
                  </span>
                ) : image ? (
                  <span className="cat-card__emblem cat-card__emblem--photo">
                    <img
                      src={image}
                      alt=""
                      width={48}
                      height={48}
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                    />
                  </span>
                ) : (
                  <span
                    className="cat-card__emblem"
                    style={{ background: style.bg }}
                  >{style.letter}</span>
                )}
                <CategoryShareRing count={count} total={totalLots} />
              </span>
              <span className="cat-card__name">{categoryLabel(cat)}</span>
            </button>
          );
        })}
      </div>
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
      <button
        type="button"
        className={`auto-deliver-filter${autoDeliverOnly ? ' is-on' : ''}`}
        aria-pressed={autoDeliverOnly}
        aria-label="Только лоты с автовыдачей"
        onClick={() => setAutoDeliverOnly((on) => !on)}
      >
        <span className="auto-deliver-filter__dot" aria-hidden="true">{autoDeliverOnly ? '✓' : ''}</span>
        <span>Автовыдача</span>
      </button>
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
      <div className="product-grid product-grid--compact">{items.map(product => (
        <ProductLotCard
          key={product.id}
          product={product}
          core={core}
          onOpen={() => void openProduct(product)}
          onFavorite={() => {
            setItems(previous => previous.map(item => item.id === product.id ? { ...item, favorite: !item.favorite } : item));
            void core.toggleFavorite(product);
          }}
        />
      ))}</div>}
    {marketState === 'success' && hasMore && (
      <Button variant="secondary" busy={loadingMore} onClick={() => void loadMore()}>{t('common.showMore')}</Button>
    )}
    </>}
    <PublicProfileModal
      profile={sellerProfile}
      title={selected ? 'Назад к оформлению' : 'Профиль'}
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
        const fromProfile = items.find((item) => item.id === productId);
        if (fromProfile) {
          void openProduct(fromProfile, 'profile');
          return;
        }
        void api.get<Product>(`${API_PATHS.products}/${encodeURIComponent(productId)}`)
          .then((product) => openProduct(product, 'profile'))
          .catch((error) => setToast(friendlyError(error)));
      }}
      setToast={setToast}
    />
    {showTop && !selected && (
      <button
        type="button"
        className="scroll-top"
        aria-label="Наверх к лотам"
        onClick={() => {
          const grid = document.querySelector('.product-grid');
          grid?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
      >↑</button>
    )}
  </div>;
}
export default Market;
