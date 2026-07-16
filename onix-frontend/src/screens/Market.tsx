import { useEffect, useState } from 'react';
import { api, money, friendlyError } from '../api/client';
import {
  API_PATHS, CATEGORIES, CATEGORY_LABELS, SUBCATEGORIES_BY_CATEGORY, SUBCATEGORY_LABELS,
  formatLastSeen, type Product, type PublicProfile,
} from '../api/contracts';
import UserAvatar from '../components/UserAvatar';
import { Badge, Button, Card, Confirm, Input, Modal, Select, Skeleton, StateView } from '../design-system';
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

  const isDefaultView = query.trim() === '' && category === 'Все' && !subcategory && sort === 'new';
  const onixQuery = query.trim().match(/^ONIX-\d+$/i)?.[0]?.toUpperCase();
  const marketSubs = category !== 'Все'
    ? (SUBCATEGORIES_BY_CATEGORY[category as typeof CATEGORIES[number]] ?? [])
    : [];

  useEffect(() => {
    if (core.states.profile === 'loading') {
      setMarketState('loading');
      return;
    }
    if (!core.profile) {
      setItems([]);
      setMarketError(core.errors.profile || 'Войдите через Telegram, чтобы продолжить.');
      setMarketState('error');
      return;
    }

    if (!isDefaultView) return;

    if (core.states.products === 'loading' || core.states.products === 'idle') {
      setMarketState('loading');
      return;
    }
    if (core.states.products === 'error') {
      setItems([]);
      setMarketError(core.errors.products || 'Витрина недоступна');
      setMarketState('error');
      return;
    }
    setItems(core.products);
    setMarketError(undefined);
    setMarketState('success');
  }, [
    core.errors.products,
    core.errors.profile,
    core.products,
    core.profile,
    core.states.products,
    core.states.profile,
    isDefaultView,
  ]);

  useEffect(() => {
    if (core.states.profile === 'loading' || !core.profile) return;
    if (isDefaultView) return;

    const controller = new AbortController();
    const debounceMs = query.trim() ? 300 : 0;
    const timer = window.setTimeout(() => {
      setMarketState('loading');
      const serverSort = sort === 'price' ? 'price_asc' as const : sort === 'rating' ? 'rating' as const : 'newest' as const;
      void core.listProducts({
        search: query.trim() || undefined,
        category: category === 'Все' ? undefined : category,
        subcategory: subcategory || undefined,
        sort: serverSort,
        limit: 30,
        offset: 0,
      }, controller.signal).then((data) => {
        setItems(data);
        setMarketError(undefined);
        setMarketState('success');
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setItems([]);
        setMarketError(friendlyError(error));
        setMarketState('error');
      });
    }, debounceMs);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [category, core.listProducts, core.profile, core.states.profile, isDefaultView, query, sort, subcategory]);

  useEffect(() => {
    if (!selected) return;
    const fresh = items.find((item) => item.id === selected.id)
      ?? core.products.find((item) => item.id === selected.id);
    if (!fresh) return;
    if (
      fresh.seller.followed !== selected.seller.followed
      || fresh.seller.followersCount !== selected.seller.followersCount
      || fresh.favorite !== selected.favorite
    ) {
      setSelected(fresh);
    }
  }, [core.products, items, selected]);

  useEffect(() => {
    if (!focusProductId) return;
    let cancelled = false;
    void (async () => {
      try {
        const fromList = items.find((item) => item.id === focusProductId)
          ?? core.products.find((item) => item.id === focusProductId);
        const product = fromList
          ?? await api.get<Product>(`${API_PATHS.products}/${encodeURIComponent(focusProductId)}`);
        if (cancelled) return;
        setSellerProfile(null);
        setSelected(product);
      } catch { /* ignore */ }
      finally {
        if (!cancelled) onFocusProductHandled();
      }
    })();
    return () => { cancelled = true; };
  }, [core.products, focusProductId, items, onFocusProductHandled]);

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
      <div className="product-grid">{items.map(product => <Card key={product.id} interactive className="product-card">
        <button className="product-main" onClick={() => setSelected(product)} aria-label={`Открыть ${product.title}`}>
          <div className="product-card__top"><Badge tone={product.status === 'ACTIVE' ? 'success' : 'warning'}>{product.status}</Badge><span>{product.category}</span></div>
          <h2>{product.title}</h2><p>{product.description || 'Описание не добавлено'}</p>
          <div className="seller-row"><span className="user-summary"><UserAvatar avatarUrl={product.seller.avatarUrl} name={product.seller.username} /><span>@{product.seller.username} <StaffBadge badge={product.seller.badge} /> · ★ {product.seller.rating.toFixed(1)} ({product.seller.reviewCount})</span></span><strong>{money(product.priceCents)}</strong></div>
        </button>
        <button className={`favorite ${product.favorite ? 'active' : ''}`} onClick={() => {
          setItems(previous => previous.map(item => item.id === product.id ? { ...item, favorite: !item.favorite } : item));
          void core.toggleFavorite(product);
        }} aria-label={product.favorite ? 'Убрать из избранного' : 'В избранное'}>♥</button>
      </Card>)}</div>}
    <Modal open={Boolean(selected)} title={selected?.title || ''} onClose={() => setSelected(null)}>
      {selected && <div className="stack compact"><div className="product-detail"><Badge tone="success">{selected.status}</Badge><strong>{money(selected.priceCents)}</strong></div>
        <p className="muted">{selected.description || 'Продавец не добавил описание.'}</p>
        <Card><div className="seller-row"><div className="user-summary"><UserAvatar avatarUrl={selected.seller.avatarUrl} name={selected.seller.username} /><div><b>@{selected.seller.username} <StaffBadge badge={selected.seller.badge} /></b><p className="muted">{selected.seller.onixId} · {selected.seller.salesCount} сделок · {selected.seller.followersCount} подписчиков · {formatLastSeen(selected.seller.lastOnline)}</p></div></div><span>★ {selected.seller.rating.toFixed(1)}</span></div>
          <div className="card-actions">
            <Button variant="secondary" onClick={async () => {
              try { setSellerProfile(await api.get<PublicProfile>(API_PATHS.userPublic(selected.seller.onixId))); } catch { /* ignore */ }
            }}>Профиль продавца</Button>
            <Button
              variant="secondary"
              busy={core.actionBusy === `follow-${selected.seller.onixId}`}
              onClick={() => {
                setItems((previous) => previous.map((item) => (
                  item.seller.onixId === selected.seller.onixId
                    ? {
                      ...item,
                      seller: {
                        ...item.seller,
                        followed: !selected.seller.followed,
                        followersCount: Math.max(0, item.seller.followersCount + (selected.seller.followed ? -1 : 1)),
                      },
                    }
                    : item
                )));
                void core.toggleFollow(selected.seller.onixId, Boolean(selected.seller.followed));
              }}
            >{selected.seller.followed ? 'Отписаться' : '+ Подписаться'}</Button>
          </div></Card>
        <div className="modal__actions"><Button variant="secondary" onClick={async () => {
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
        await openDirectChat(onixId);
      }}
      onOpenProduct={(productId) => {
        setSellerProfile(null);
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
