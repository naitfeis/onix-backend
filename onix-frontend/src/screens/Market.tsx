import { useEffect, useState } from 'react';
import { api, money, friendlyError } from '../api/client';
import {
  API_PATHS, CATEGORIES, CATEGORY_LABELS, SUBCATEGORIES_BY_CATEGORY, SUBCATEGORY_LABELS,
  formatLastSeen, sellerIsPresent, type Product, type PublicProfile, type TrustCard,
} from '../api/contracts';
import UserAvatar from '../components/UserAvatar';
import { Button, Card, Confirm, Input, Modal, Select, Skeleton, StateView } from '../design-system';
import { formatOnixId } from '../utils/onixId';
import { publicAt } from '../utils/publicAt';
import type { Core, Screen } from './types';
import { PublicProfileModal, StaffBadge } from './shared';

export function Market({
  core, switchTo, setToast, focusProductId, onFocusProductHandled, openDirectChat, openProductCard, openDealChat,
}: {
  core: Core;
  switchTo: (screen: Screen) => void;
  setToast: (text: string) => void;
  focusProductId: string | null;
  onFocusProductHandled: () => void;
  openDirectChat: (onixId: string) => Promise<boolean>;
  openProductCard: (productId: string) => void;
  openDealChat: (chatId: string) => void;
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
  const PAGE = 10;
  const isAdmin = Boolean(
    core.profile?.isAdmin
    || core.profile?.status === 'ADMIN'
    || core.profile?.roles.includes('ADMIN'),
  );

  const lotLabel = (product: Product) => (
    product.lotNumber != null ? `ONIXLOT-${product.lotNumber}` : null
  );

  /** List cards are lean — load full product (description + seller stats) on open. */
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

  // Lean list stubs followersCount/followed and omits description — sync favorite only.
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

  return <div className="stack">
    <div className="search-row"><Input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Товар, продавец или ONIX ID" aria-label="Поиск" />
      <Select value={sort} onChange={event => setSort(event.target.value)} aria-label="Сортировка"><option value="new">Сначала новые</option><option value="price">Сначала дешевле</option><option value="rating">По рейтингу</option></Select></div>
    {onixQuery && <Button variant="secondary" onClick={async () => {
      try { setSellerProfile(await api.get<PublicProfile>(API_PATHS.userPublic(onixQuery))); } catch { /* ignore */ }
    }}>Открыть профиль</Button>}
    <div className="chips" role="list" aria-label="Категории">{['Все', ...CATEGORIES].map(item =>
      <button role="listitem" className={category === item ? 'active' : ''} key={item} onClick={() => {
        setCategory(item);
        setSubcategory('');
      }}>{item === 'Все' ? item.toUpperCase() : CATEGORY_LABELS[item as keyof typeof CATEGORY_LABELS].toUpperCase()}</button>)}</div>
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
    {marketState === 'loading' ? <div className="product-grid"><Card><Skeleton lines={4} /></Card><Card><Skeleton lines={4} /></Card></div> :
      marketState === 'error' ? <StateView title="Витрина недоступна" text={marketError || ''} action={<Button onClick={() => void core.refreshAll()}>Попробовать снова</Button>} /> :
      items.length === 0 ? <StateView title="Ничего не найдено" text="Измените запрос или фильтры. Можно разместить собственный лот." action={<Button onClick={() => switchTo('create')}>Разместить лот</Button>} /> :
      <div className="product-grid product-grid--compact">{items.map(product => <Card key={product.id} interactive className="product-card product-card--compact">
        <button className="product-main" onClick={() => void openProduct(product)} aria-label={`Открыть ${product.title}`}>
          <div className="product-card__top">
            <span>{product.category}</span>
            {lotLabel(product) && <span className="onixlot-id">{lotLabel(product)}</span>}
          </div>
          <h2>{product.title.length > 32 ? `${product.title.slice(0, 32)}…` : product.title}</h2>
          <div className="seller-row"><span className="user-summary"><UserAvatar avatarUrl={product.seller.avatarUrl} name={product.seller.username} online={sellerIsPresent(product.seller, core.profile)} /><span>{publicAt(product.seller.username)} <StaffBadge badge={product.seller.badge} /> · ★ {product.seller.rating.toFixed(1)} · {product.seller.reviewCount} отз.</span></span><strong>{money(product.priceCents)}</strong></div>
        </button>
        <button className={`favorite ${product.favorite ? 'active' : ''}`} onClick={() => {
          setItems(previous => previous.map(item => item.id === product.id ? { ...item, favorite: !item.favorite } : item));
          void core.toggleFavorite(product);
        }} aria-label={product.favorite ? 'Убрать из избранного' : 'В избранное'}>♥</button>
      </Card>)}</div>}
    {marketState === 'success' && hasMore && (
      <Button variant="secondary" busy={loadingMore} onClick={() => void loadMore()}>Загрузить ещё</Button>
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
              try { setSellerProfile(await api.get<PublicProfile>(API_PATHS.userPublic(selected.seller.onixId))); } catch { /* ignore */ }
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
        }}>Написать</Button><Button disabled={selected.status !== 'ACTIVE'} onClick={() => setConfirm(selected)}>Купить</Button></div>
      </div>}
    </Modal>
    <PublicProfileModal
      profile={sellerProfile}
      onClose={() => setSellerProfile(null)}
      core={core}
      onOpenOnix={async (onixId) => {
        if (sellerProfile?.onixId === onixId) return;
        try { setSellerProfile(await api.get<PublicProfile>(API_PATHS.userPublic(onixId))); } catch { /* ignore */ }
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
