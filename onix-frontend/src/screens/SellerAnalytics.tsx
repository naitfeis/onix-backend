import { useEffect, useMemo, useState } from 'react';
import { api, money } from '../api/client';
import { API_PATHS, type SellerAnalytics } from '../api/contracts';
import { Card, Skeleton, StateView } from '../design-system';

const CHART_W = 320;
const CHART_H = 140;
const PAD_L = 44;
const PAD_R = 10;
const PAD_T = 10;
const PAD_B = 22;

/** Up to 5 horizontal guides from distinct positive values (largest first). */
function pickGuideValues(values: number[], maxGuides = 5): number[] {
  const uniq = [...new Set(values.filter((v) => v > 0))].sort((a, b) => b - a);
  if (uniq.length <= maxGuides) return uniq.sort((a, b) => a - b);
  return uniq.slice(0, maxGuides).sort((a, b) => a - b);
}

function formatGuide(value: number, unit: 'rub' | 'views'): string {
  if (unit === 'rub') {
    const n = Math.round(value);
    return n >= 1000
      ? `${n.toLocaleString('ru-RU')} ₽`
      : `${n} ₽`;
  }
  return `${Math.round(value)}`;
}

function GuidedBarChart({
  values,
  labels,
  color,
  unit,
}: {
  values: number[];
  labels: string[];
  color: string;
  unit: 'rub' | 'views';
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...values);
  const guides = useMemo(() => pickGuideValues(values, 5), [values]);
  const plotW = CHART_W - PAD_L - PAD_R;
  const plotH = CHART_H - PAD_T - PAD_B;
  const gap = 2;
  const barW = Math.max(2, (plotW / Math.max(1, values.length)) - gap);
  const yOf = (v: number) => PAD_T + plotH - ((v / max) * plotH);
  const mid = labels[Math.floor(labels.length / 2)] ?? '';

  return (
    <div className="analytics-chart-wrap">
      <svg
        className="analytics-chart"
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        role="img"
        aria-label={unit === 'rub' ? 'Выручка по дням' : 'Просмотры по дням'}
      >
        {guides.map((g) => {
          const y = yOf(g);
          return (
            <g key={`g-${g}`}>
              <line
                x1={PAD_L}
                x2={CHART_W - PAD_R}
                y1={y}
                y2={y}
                className="analytics-chart__guide"
                stroke={color}
              />
              <text
                x={PAD_L - 4}
                y={y + 3}
                textAnchor="end"
                className="analytics-chart__guide-label"
              >{formatGuide(g, unit)}</text>
            </g>
          );
        })}
        {values.map((v, i) => {
          const bh = Math.max(v > 0 ? 2 : 0, (v / max) * plotH);
          const x = PAD_L + i * (barW + gap);
          const y = PAD_T + plotH - bh;
          const active = hover === i;
          return (
            <g key={labels[i] ?? i}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={bh || 0}
                fill={color}
                opacity={active ? 1 : 0.85}
                rx="1.5"
                className="analytics-chart__bar"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              >
                <title>{`${labels[i]}: ${formatGuide(v, unit)}`}</title>
              </rect>
              {/* Hit area for thin bars */}
              <rect
                x={x}
                y={PAD_T}
                width={Math.max(barW, 6)}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          );
        })}
        <text x={PAD_L} y={CHART_H - 4} className="analytics-chart__label">{labels[0]}</text>
        <text x={(PAD_L + CHART_W - PAD_R) / 2} y={CHART_H - 4} textAnchor="middle" className="analytics-chart__label">{mid}</text>
        <text x={CHART_W - PAD_R} y={CHART_H - 4} textAnchor="end" className="analytics-chart__label">{labels[labels.length - 1]}</text>
      </svg>
      {hover != null && values[hover] != null && (
        <div className="analytics-chart__tooltip" role="status">
          <b>{labels[hover]}</b>
          <span>{formatGuide(values[hover]!, unit)}</span>
        </div>
      )}
    </div>
  );
}

export function SellerAnalyticsPanel({ days = 30 }: { days?: number }) {
  const [data, setData] = useState<SellerAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api.get<SellerAnalytics>(API_PATHS.meAnalytics(days))
      .then((row) => { if (!cancelled) setData(row); })
      .catch(() => { if (!cancelled) setError('Не удалось загрузить аналитику.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  if (loading) return <Card><Skeleton lines={6} /></Card>;
  if (error || !data) return <StateView title="Аналитика недоступна" text={error || ''} />;

  const viewValues = data.series.map((d) => d.uniqueViews);
  const revenueValues = data.series.map((d) => Number(d.revenueCents) / 100);
  const labels = data.series.map((d) => d.day.slice(5));

  return (
    <div className="stack compact analytics-panel">
      <Card>
        <h2>// АНАЛИТИКА · {data.days} ДН.</h2>
        <div className="stats analytics-stats">
          <span><b>{data.totals.uniqueViews}</b> просмотров</span>
          <span><b>{data.totals.completedCount}</b> продаж</span>
          <span><b>{money(data.totals.revenueCents)}</b> выручка</span>
          <span><b>{data.totals.favoritesAdded}</b> в избранное</span>
        </div>
      </Card>
      <Card>
        <h2>Просмотры</h2>
        <p className="muted">Уникальные просмотры лотов по дням</p>
        <GuidedBarChart values={viewValues} labels={labels} color="#7dd3c0" unit="views" />
      </Card>
      <Card>
        <h2>Выручка</h2>
        <p className="muted">Сумма завершённых сделок, ₽ — жёлтые колонки</p>
        <GuidedBarChart values={revenueValues} labels={labels} color="#e8c547" unit="rub" />
      </Card>
    </div>
  );
}

export default SellerAnalyticsPanel;
