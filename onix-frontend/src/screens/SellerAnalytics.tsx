import { useEffect, useMemo, useState } from 'react';
import { api, money } from '../api/client';
import { API_PATHS, type SellerAnalytics } from '../api/contracts';
import { Button, Card, Skeleton, StateView } from '../design-system';

const CHART_W = 320;
const CHART_H = 148;
const PAD_L = 48;
const PAD_R = 10;
const PAD_T = 10;
const PAD_B = 28;

/** Always up to 7 evenly spaced guides from 0→max (weekly chart readability). */
function pickGuideValues(max: number, guideCount = 7): number[] {
  if (!(max > 0)) return [];
  const steps = Math.max(1, Math.min(7, guideCount));
  const out: number[] = [];
  for (let i = 1; i <= steps; i += 1) {
    out.push((max * i) / steps);
  }
  return out;
}

function formatGuide(value: number, unit: 'rub' | 'views'): string {
  if (unit === 'rub') {
    const n = Math.round(value);
    return n >= 1000 ? `${n.toLocaleString('ru-RU')} ₽` : `${n} ₽`;
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
  const guides = useMemo(() => pickGuideValues(max, 7), [max]);
  const plotW = CHART_W - PAD_L - PAD_R;
  const plotH = CHART_H - PAD_T - PAD_B;
  const gap = 4;
  const barW = Math.max(8, (plotW / Math.max(1, values.length)) - gap);
  const yOf = (v: number) => PAD_T + plotH - ((v / max) * plotH);

  return (
    <div className="analytics-chart-wrap">
      <svg
        className="analytics-chart"
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        role="img"
        aria-label={unit === 'rub' ? 'Выручка за неделю' : 'Просмотры за неделю'}
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
          const bh = Math.max(v > 0 ? 3 : 0, (v / max) * plotH);
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
                opacity={active ? 1 : 0.88}
                rx="2"
                className="analytics-chart__bar"
              >
                <title>{`${labels[i]}: ${formatGuide(v, unit)}`}</title>
              </rect>
              <rect
                x={x}
                y={PAD_T}
                width={Math.max(barW, 10)}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
              <text
                x={x + barW / 2}
                y={CHART_H - 6}
                textAnchor="middle"
                className="analytics-chart__label"
              >{labels[i]}</text>
            </g>
          );
        })}
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

export function SellerAnalyticsPanel() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [data, setData] = useState<SellerAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api.get<SellerAnalytics>(API_PATHS.meAnalytics(weekOffset))
      .then((row) => { if (!cancelled) setData(row); })
      .catch(() => { if (!cancelled) setError('Не удалось загрузить аналитику.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [weekOffset]);

  if (loading && !data) return <Card><Skeleton lines={6} /></Card>;
  if (error || !data) return <StateView title="Аналитика недоступна" text={error || ''} />;

  const viewValues = data.series.map((d) => d.uniqueViews);
  const revenueValues = data.series.map((d) => Number(d.revenueCents) / 100);
  const labels = data.series.map((d) => d.weekday ?? d.day.slice(5));
  const title = data.label
    ? `НЕДЕЛЯ · ${data.label}`
    : `${data.from.slice(5)} — ${data.to.slice(5)}`;

  return (
    <div className="stack compact analytics-panel">
      <Card>
        <div className="analytics-week-nav">
          <Button
            variant="secondary"
            disabled={!data.canGoPrev || loading}
            onClick={() => setWeekOffset((w) => w - 1)}
          >←</Button>
          <div className="analytics-week-nav__label">
            <h2>// АНАЛИТИКА · {title}</h2>
            <p className="muted">{weekOffset === 0 ? 'Текущая неделя (пн–вс)' : 'Архив недели'}</p>
          </div>
          <Button
            variant="secondary"
            disabled={!data.canGoNext || loading}
            onClick={() => setWeekOffset((w) => Math.min(0, w + 1))}
          >→</Button>
        </div>
        <div className="stats analytics-stats">
          <span><b>{data.totals.uniqueViews}</b> просмотров</span>
          <span><b>{data.totals.completedCount}</b> продаж</span>
          <span><b>{money(data.totals.revenueCents)}</b> выручка</span>
          <span><b>{data.totals.favoritesAdded}</b> в избранное</span>
        </div>
      </Card>
      <Card>
        <h2>Просмотры</h2>
        <p className="muted">Уникальные просмотры по дням недели</p>
        <GuidedBarChart values={viewValues} labels={labels} color="#7dd3c0" unit="views" />
      </Card>
      <Card>
        <h2>Выручка</h2>
        <p className="muted">Завершённые сделки, ₽ — жёлтые колонки</p>
        <GuidedBarChart values={revenueValues} labels={labels} color="#e8c547" unit="rub" />
      </Card>
    </div>
  );
}

export default SellerAnalyticsPanel;
