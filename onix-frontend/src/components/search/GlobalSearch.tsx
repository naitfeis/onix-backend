import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { SUBCATEGORY_LABELS, type SubcategoryCatalog } from '../../api/contracts';
import CategoryCountBadge from '../CategoryCountBadge';
import { matchCategories, matchSubcategories, highlightParts } from '../../search/matchCategories';
import { CATEGORY_IMAGES } from '../../utils/categoryImages';

export type GlobalSearchResult = {
  category: string;
  label: string;
  subcategories: readonly string[];
};

type GlobalSearchProps = {
  counts: Record<string, number>;
  total: number;
  catalog: SubcategoryCatalog;
  onOpenCategory: (category: string) => void;
  onOpenSubcategory: (category: string, subcategory: string) => void;
  onSearchLots: (query: string) => void;
};

export default function GlobalSearch({
  counts, total, catalog, onOpenCategory, onOpenSubcategory, onSearchLots,
}: GlobalSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const options = useMemo(() => matchCategories(query, counts).map((match) => ({
    category: match.category,
    label: match.label,
    subcategories: (catalog[match.category] ?? []).slice(0, 8),
  })), [query, counts, catalog]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((event.key === '/' || (event.ctrlKey && event.key.toLowerCase() === 'k')) && !inField) {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  useEffect(() => setActiveIndex(0), [query]);

  const move = (delta: number) => {
    if (options.length === 0) return;
    setActiveIndex((index) => (index + delta + options.length) % options.length);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
    else if (event.key === 'Escape') {
      if (query) setQuery('');
      else setOpen(false);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) onOpenCategory(option.category);
      else if (query.trim()) onSearchLots(query.trim());
      setOpen(false);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  const listId = 'global-search-list';
  const activeId = open && options[activeIndex] ? `global-search-option-${activeIndex}` : undefined;
  const noMatches = Boolean(query.trim()) && options.length === 0;

  return (
    <div className="gsearch" ref={rootRef}>
      <div className="gsearch__field">
        <svg className="gsearch__icon" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="9" cy="9" r="6" />
          <path d="M13.5 13.5 17 17" />
        </svg>
        <input
          ref={inputRef}
          role="combobox"
          type="text"
          value={query}
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-label="Поиск игр и категорий"
          placeholder="Поиск игр и категорий…"
          onChange={(event) => { setQuery(event.target.value); setOpen(event.target.value.trim().length > 0); }}
          onFocus={() => { if (query.trim()) setOpen(true); }}
          onKeyDown={onKeyDown}
        />
        {query ? (
          <button type="button" className="gsearch__clear" aria-label="Очистить" onClick={() => { setQuery(''); inputRef.current?.focus(); }}>×</button>
        ) : null}
      </div>
      {open && (
        <div className="gsearch__panel" id={listId} role="listbox" ref={panelRef}>
          {noMatches ? (
            <div className="gsearch__empty">
              <p>Ничего не найдено</p>
              <button type="button" className="gsearch__lots" onClick={() => { onSearchLots(query.trim()); setOpen(false); }}>
                Искать лоты по «{query.trim()}»
              </button>
            </div>
          ) : options.map((option, index) => {
            const image = CATEGORY_IMAGES[option.category];
            const parts = highlightParts(option.label, query);
            const matchedSubs = query.trim() ? matchSubcategories(option.subcategories, SUBCATEGORY_LABELS, query) : [];
            const isActive = index === activeIndex;
            return (
              <div
                key={option.category}
                id={`global-search-option-${index}`}
                role="option"
                aria-selected={isActive}
                className={`gsearch__group${isActive ? ' is-active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <button type="button" className="gsearch__group-head" onClick={() => { onOpenCategory(option.category); setOpen(false); }}>
                  {image ? (
                    <span className="gsearch__emblem"><img src={image} alt="" width={32} height={32} loading="lazy" /></span>
                  ) : (
                    <span className="gsearch__emblem gsearch__emblem--text">{option.label.slice(0, 2)}</span>
                  )}
                  <span className="gsearch__name">
                    {parts ? <>{parts[0]}<mark>{parts[1]}</mark>{parts[2]}</> : (query.trim() ? option.label : option.label)}
                  </span>
                  <CategoryCountBadge count={counts[option.category] ?? 0} total={total || 1} variant="sidebar" />
                </button>
                {option.subcategories.length > 0 && (
                  <div className="gsearch__subs">
                    {option.subcategories.map((sub) => (
                      <button
                        type="button"
                        key={sub}
                        className={`gsearch__sub${matchedSubs.includes(sub) ? ' is-matched' : ''}`}
                        onClick={() => { onOpenSubcategory(option.category, sub); setOpen(false); }}
                      >
                        {SUBCATEGORY_LABELS[sub] ?? sub}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {query.trim() && matchCategories(query, counts, 100).length > options.length && (
            <button type="button" className="gsearch__all" onClick={() => { onSearchLots(query.trim()); setOpen(false); }}>
              Показать все результаты ({matchCategories(query, counts, 100).length})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
