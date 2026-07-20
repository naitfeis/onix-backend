import { useEffect, useRef, type CSSProperties } from 'react';

type OrbSpec = {
  color: string;
  size: number;
  opacity: number;
  top: string;
  left: string;
  duration: string;
  delay: string;
};

/**
 * Fixed soft rim: CSS `filter: blur(14px)` on .orb only.
 * Sizes stay large enough that 14px ≈ ≤10% of diameter → circle stays readable.
 * No per-orb blur values — stacking with card backdrop-filter is forbidden.
 */
const ORBS_DARK: OrbSpec[] = [
  { color: '#8b6bff', size: 160, opacity: 0.58, top: '5%', left: '10%', duration: '22s', delay: '0s' },
  { color: '#ff6fb8', size: 120, opacity: 0.52, top: '4%', left: '88%', duration: '26s', delay: '-5s' },
  { color: '#4fc3f7', size: 140, opacity: 0.55, top: '14%', left: '70%', duration: '20s', delay: '-10s' },
  { color: '#7c5cff', size: 180, opacity: 0.55, top: '28%', left: '16%', duration: '28s', delay: '-3s' },
  { color: '#5ac8fa', size: 110, opacity: 0.5, top: '52%', left: '86%', duration: '18s', delay: '-8s' },
  { color: '#e94fb0', size: 150, opacity: 0.52, top: '68%', left: '8%', duration: '24s', delay: '-12s' },
  { color: '#7c5cff', size: 130, opacity: 0.5, top: '84%', left: '58%', duration: '30s', delay: '-6s' },
];

/**
 * Light — full-canvas coverage, 4+ distinct hues (incl. yellow accent).
 * Positions: all four corners + top band + mid-right (TZ vs reference).
 */
const ORBS_LIGHT: OrbSpec[] = [
  /* 1 large lavender — top left */
  { color: '#a78bfa', size: 170, opacity: 0.65, top: '8%', left: '12%', duration: '22s', delay: '0s' },
  /* 2 violet — top center */
  { color: '#9b6bff', size: 145, opacity: 0.62, top: '5%', left: '48%', duration: '24s', delay: '-4s' },
  /* 3 pink — top right */
  { color: '#ff8fc4', size: 120, opacity: 0.6, top: '6%', left: '80%', duration: '26s', delay: '-8s' },
  /* 4 yellow-orange accent — beside pink, top right */
  { color: '#ffd88a', size: 72, opacity: 0.68, top: '10%', left: '92%', duration: '18s', delay: '-2s' },
  /* 5 cyan — mid left edge */
  { color: '#7fd4ec', size: 125, opacity: 0.58, top: '42%', left: '8%', duration: '28s', delay: '-10s' },
  /* 6 small pink — center, toward right */
  { color: '#f5a8d0', size: 95, opacity: 0.55, top: '40%', left: '76%', duration: '20s', delay: '-6s' },
  /* 7 large lavender — bottom left (under sidebar) */
  { color: '#9b6bff', size: 180, opacity: 0.62, top: '88%', left: '14%', duration: '30s', delay: '-12s' },
  /* 8 cyan/violet — bottom right (under right column) */
  { color: '#7fd4ec', size: 155, opacity: 0.58, top: '86%', left: '82%', duration: '25s', delay: '-5s' },
  /* 9 soft violet — lower mid for density */
  { color: '#a78bfa', size: 110, opacity: 0.52, top: '70%', left: '52%', duration: '21s', delay: '-9s' },
];

function buildStars(count: number, seedStart: number) {
  const stars: Array<{
    x: string;
    y: string;
    size: number;
    o: number;
    bright: boolean;
    delay: string;
    dur: string;
  }> = [];
  let seed = seedStart;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < count; i += 1) {
    const bright = i < 7;
    stars.push({
      x: `${(rnd() * 100).toFixed(2)}%`,
      y: `${(rnd() * 100).toFixed(2)}%`,
      size: bright ? 2 : 1.5 + rnd() * 0.5,
      o: 0.55 + rnd() * 0.25,
      bright,
      delay: `${(rnd() * 3).toFixed(2)}s`,
      dur: `${(2 + rnd() * 2).toFixed(2)}s`,
    });
  }
  return stars;
}

const STARS_DARK = buildStars(55, 42);
const STARS_LIGHT = buildStars(32, 91);

function Orb({
  color,
  size,
  opacity,
  top,
  left,
  duration,
  delay,
}: OrbSpec) {
  return (
    <div
      className="orb"
      style={{
        top,
        left,
        width: size,
        height: size,
        opacity,
        '--orb-color': color,
        '--orb-dur': duration,
        '--orb-delay': delay,
      } as CSSProperties}
    />
  );
}

/**
 * Scene: base + sharp orbs (single blur layer on .orb only) + stars.
 */
export default function OnixBackground({ mode }: { mode: 'normal' | 'focus' | 'chat' }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.dataset.mode = mode;
  }, [mode]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.dataset.reduced = 'true';
    }
  }, []);

  return (
    <div ref={ref} className="onix-bg" aria-hidden="true" data-mode={mode}>
      <div className="onix-bg__base" />

      <div className="onix-bg__orbs onix-bg__orbs--dark">
        {ORBS_DARK.map((spec, i) => (
          <Orb key={`d-${i}`} {...spec} />
        ))}
      </div>

      <div className="onix-bg__orbs onix-bg__orbs--light">
        {ORBS_LIGHT.map((spec, i) => (
          <Orb key={`l-${i}`} {...spec} />
        ))}
      </div>

      <div className="onix-bg__vignette" />

      <div className="onix-bg__stars onix-bg__stars--dark">
        {STARS_DARK.map((star, i) => (
          <i
            key={`sd-${i}`}
            className={`onix-bg__star${star.bright ? ' onix-bg__star--bright' : ''}`}
            style={{
              left: star.x,
              top: star.y,
              width: star.size,
              height: star.size,
              opacity: star.o,
              '--delay': star.delay,
              '--dur': star.dur,
            } as CSSProperties}
          />
        ))}
      </div>

      <div className="onix-bg__stars onix-bg__stars--light">
        {STARS_LIGHT.map((star, i) => (
          <i
            key={`sl-${i}`}
            className="onix-bg__star onix-bg__star--light"
            style={{
              left: star.x,
              top: star.y,
              width: star.size,
              height: star.size,
              opacity: star.o,
              '--delay': star.delay,
              '--dur': star.dur,
            } as CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}
