import { usePwaInstall } from '../pwa/usePwaInstall';

export default function PwaInstallBanner() {
  const { mode, install, dismiss } = usePwaInstall();
  if (mode === 'hidden') return null;

  const title = mode === 'ios-guide' ? 'Установить ONIX' : 'Установить приложение';
  const body = mode === 'ios-guide'
    ? 'Нажмите «Поделиться», затем «На экран „Домой“».'
    : 'Откройте ONIX как отдельное приложение на устройстве.';

  return (
    <div className="pwa-install" role="region" aria-label="Установка ONIX">
      <img className="pwa-install__mark" src="/brand/onix-mark.png" width={40} height={40} alt="" />
      <div className="pwa-install__copy">
        <strong>{title}</strong>
        <span>{body}</span>
      </div>
      <div className="pwa-install__actions">
        {mode === 'prompt' ? (
          <button type="button" className="pwa-install__primary" onClick={() => { void install(); }}>
            Установить
          </button>
        ) : null}
        <button type="button" className="pwa-install__dismiss" onClick={dismiss} aria-label="Скрыть">
          ×
        </button>
      </div>
    </div>
  );
}
