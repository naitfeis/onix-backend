import { useEffect, useRef } from 'react';

/**
 * Clean scene background — solid color only.
 * No orbs/stars/vignette (those caused glass banding / «потеки»).
 */
export default function OnixBackground({ mode }: { mode: 'normal' | 'focus' | 'chat' }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => root.setAttribute('data-reduced', mq.matches ? 'true' : 'false');
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  return (
    <div ref={rootRef} className="onix-bg" data-mode={mode} aria-hidden="true">
      <div className="onix-bg__base" />
    </div>
  );
}
