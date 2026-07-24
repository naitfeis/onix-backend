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
 * Fixed soft rim: CSS `filter: blur(22px)` on .orb only.
 * Sizes stay large enough that blur ≈ ≤15% of diameter → circle stays readable.
 * No per-orb blur values — stacking with card backdrop-filter is forbidden.
 */
const ORBS_DARK: OrbSpec[] = [
  { color: '#8b6bff', size: 220, opacity: 0.38, top: '8%', left: '12%', duration: '28s', delay: '0s' },
  { color: '#4fc3f7', size: 200, opacity: 0.32, top: '18%', left: '78%', duration: '32s', delay: '-8s' },
  { color: '#7c5cff', size: 240, opacity: 0.34, top: '62%', left: '18%', duration: '30s', delay: '-4s' },
  { color: '#5ac8fa', size: 180, opacity: 0.28, top: '72%', left: '82%', duration: '26s', delay: '-12s' },
];

/**
 * Light — soft daylight mist (fewer orbs, lower opacity → no glass banding streaks).
 */
const ORBS_LIGHT: OrbSpec[] = [
  { color: '#7eb8e8', size: 240, opacity: 0.42, top: '10%', left: '14%', duration: '28s', delay: '0s' },
  { color: '#a8c4e0', size: 200, opacity: 0.36, top: '8%', left: '72%', duration: '30s', delay: '-6s' },
  { color: '#90b0d0', size: 220, opacity: 0.38, top: '78%', left: '18%', duration: '32s', delay: '-10s' },
  { color: '#78c4d4', size: 190, opacity: 0.34, top: '70%', left: '80%', duration: '26s', delay: '-4s' },
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

const STARS_DARK = buildStars(28, 42);
const STARS_LIGHT = buildStars(18, 91);

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
