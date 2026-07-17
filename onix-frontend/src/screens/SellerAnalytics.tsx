import { useEffect, useState } from 'react';
import { api, money } from '../api/client';
import { API_PATHS, type SellerAnalytics } from '../api/contracts';
import { Card, Skeleton, StateView } from '../design-system';

function LineChart({
  values,
  labels,
  color,
}: {
  values: number[];
  labels: string[];
  color: string;
}) {
  const w = 320;
  const h = 120;
  const pad = 12;
  const max = Math.max(1, ...values);
  const points = values.map((v, i) => {
    const x = pad + (i * (w - pad * 2)) / Math.max(1, values.length - 1);
    const y = h - pad - ((v / max) * (h - pad * 2));
    return `${x},${y}`;
  }).join(' ');
  const mid = labels[Math.floor(labels.length / 2)] ?? '';
  return (
    <svg className="analytics-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="График">
      <polyline fill="none" stroke={color} strokeWidth="2.5" points={points} />
      {values.map((v, i) => {
        const x = pad + (i * (w - pad * 2)) / Math.max(1, values.length - 1);
        const y = h - pad - ((v / max) * (h - pad * 2));
        return <circle key={labels[i] ?? i} cx={x} cy={y} r="2.5" fill={color} />;
      })}
      <text x={pad} y={h - 2} className="analytics-chart__label">{labels[0]}</text>
      <text x={w / 2} y={h - 2} textAnchor="middle" className="analytics-chart__label">{mid}</text>
      <text x={w - pad} y={h - 2} textAnchor="end" className="analytics-chart__label">{labels[labels.length - 1]}</text>
    </svg>
  );
}

function BarChart({ values, color }: { values: number[]; color: string }) {
  const w = 320;
  const h = 120;
  const pad = 12;
  const max = Math.max(1, ...values);
  const gap = 2;
  const barW = Math.max(2, ((w - pad * 2) / Math.max(1, values.length)) - gap);
  return (
    <svg className="analytics-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Столбцы">
      {values.map((v, i) => {
        const bh = ((v / max) * (h - pad * 2));
        const x = pad + i * (barW + gap);
        const y = h - pad - bh;
        return <rect key={i} x={x} y={y} width={barW} height={Math.max(1, bh)} fill={color} rx="1" />;
      })}
    </svg>
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
        <LineChart values={viewValues} labels={labels} color="#7dd3c0" />
      </Card>
      <Card>
        <h2>Выручка</h2>
        <p className="muted">Сумма завершённых сделок, ₽</p>
        <BarChart values={revenueValues} color="#e8c547" />
      </Card>
    </div>
  );
}

export default SellerAnalyticsPanel;
