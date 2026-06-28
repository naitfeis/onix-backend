import { useState } from 'react';
import { useMarketCore } from '../hooks/useMarketCore';
import type { IProduct } from '../hooks/useMarketCore';

const CATEGORIES = ['', 'STANDOFF 2', 'STEAM', 'RP ПРОЕКТЫ', 'ROBLOX', 'BRAWL STARS', 'ДРУГОЕ'];

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'АКТИВЕН',
  RESERVED: 'ЗАРЕЗЕРВИРОВАН',
  SOLD_OUT: 'ПРОДАН',
};

interface Props { tgId: string }

export default function MarketScreen({ tgId }: Props) {
  const {
    products, loading, selectedProduct, setSelectedProduct,
    categoryFilter, setCategoryFilter,
    refreshMarket, buyProduct,
  } = useMarketCore(tgId);

  const [buying, setBuying] = useState(false);

  const handleCategoryChange = (cat: string) => {
    setCategoryFilter(cat);
    void refreshMarket(cat || undefined);
  };

  const handleBuy = async (product: IProduct) => {
    if (buying) return;
    setBuying(true);
    await buyProduct(product);
    setBuying(false);
  };

  if (loading) {
    return <div style={{ color: '#444', textAlign: 'center', padding: '40px', fontFamily: 'monospace' }}>ЗАГРУЗКА ВИТРИНЫ...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* Шапка */}
      <div style={{ background: '#0b0b0b', border: '1px solid #161616', padding: '12px', borderRadius: '4px' }}>
        <div style={{ fontSize: '11px', color: '#fff', fontWeight: 'bold' }}>// 🛒 ВИТРИНА ONIX MARKETPLACE</div>
        <div style={{ fontSize: '9px', color: '#555', marginTop: '2px' }}>КОМИССИЯ ДЛЯ ПОКУПАТЕЛЕЙ: 0%</div>
      </div>

      {/* Фильтр категорий */}
      <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
        {CATEGORIES.map((cat) => (
          <button
            key={cat || 'all'}
            onClick={() => handleCategoryChange(cat)}
            style={{
              flexShrink: 0,
              padding: '6px 12px',
              background: categoryFilter === cat ? '#fff' : '#0b0b0b',
              color: categoryFilter === cat ? '#000' : '#555',
              border: '1px solid #1c1c1c',
              borderRadius: '4px',
              fontSize: '10px',
              fontWeight: 'bold',
              cursor: 'pointer',
              fontFamily: 'monospace',
              whiteSpace: 'nowrap',
            }}
          >
            {cat || 'ВСЕ'}
          </button>
        ))}
      </div>

      {/* Список лотов */}
      {products.length === 0 ? (
        <div style={{ color: '#333', fontSize: '11px', textAlign: 'center', padding: '40px', border: '1px dashed #1a1a1a', borderRadius: '4px' }}>
          Лотов в этой категории пока нет.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {products.map((product) => {
            const priceRub = (parseInt(product.priceCents) / 100).toFixed(2);
            const isSelected = selectedProduct?.id === product.id;

            return (
              <div
                key={product.id}
                onClick={() => setSelectedProduct(isSelected ? null : product)}
                style={{
                  background: '#050508',
                  border: `1px solid ${isSelected ? '#00d2d3' : '#1c1c1c'}`,
                  padding: '14px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#fff', marginBottom: '4px' }}>
                      {product.title}
                    </div>
                    {product.description && (
                      <div style={{ fontSize: '10px', color: '#555', marginBottom: '6px', lineHeight: '1.4' }}>
                        {product.description}
                      </div>
                    )}
                    <div style={{ fontSize: '9px', color: '#444' }}>
                      {product.category} // @{product.sellerNick}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', marginLeft: '12px' }}>
                    <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#00d2d3' }}>{priceRub} ₽</div>
                    <div style={{ fontSize: '9px', color: product.status === 'ACTIVE' ? '#1dd1a1' : '#ff4757', marginTop: '2px' }}>
                      {STATUS_LABEL[product.status] ?? product.status}
                    </div>
                  </div>
                </div>

                {/* Кнопка покупки — раскрывается при выборе */}
                {isSelected && product.status === 'ACTIVE' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleBuy(product); }}
                    disabled={buying}
                    style={{
                      width: '100%', marginTop: '12px',
                      padding: '12px',
                      background: buying ? '#1a1a1a' : '#00d2d3',
                      color: buying ? '#555' : '#000',
                      border: 'none', borderRadius: '4px',
                      fontSize: '12px', fontWeight: 'bold',
                      cursor: buying ? 'not-allowed' : 'pointer',
                      fontFamily: 'monospace',
                    }}
                  >
                    {buying ? 'ОБРАБОТКА...' : `💳 КУПИТЬ ЗА ${priceRub} ₽`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}