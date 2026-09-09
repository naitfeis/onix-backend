/** Compact trust level + progress bar (score shown as 0–100, never raw 0–1000). */
export function TrustLevelMeter({
  level,
  progress,
  className = '',
}: {
  level: number;
  /** 0–100 progress within the public meter. */
  progress?: number | null;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(progress ?? 0)));
  return (
    <div className={`trust-meter ${className}`.trim()} aria-label={`Уровень ${level} доверия, ${pct} из 100`}>
      <strong className="trust-meter__level">Уровень {level}</strong>
      <div className="trust-meter__track" aria-hidden="true">
        <span className="trust-meter__fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="trust-meter__meta">
        <span>доверия</span>
        <span>{pct} / 100</span>
      </div>
    </div>
  );
}
