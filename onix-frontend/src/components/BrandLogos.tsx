/** Official-looking brand marks used on login, checkout, and withdraw. */

export function TelegramLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21.5 3.4 2.9 10.6c-1.3.5-1.3 1.2-.2 1.5l4.8 1.5 11.1-7c.5-.3 1-.1.6.2l-9 8.2-.3 4.8c.5 0 .7-.2 1-.5l2.4-2.3 5 3.7c.9.5 1.6.2 1.8-.9l3.3-15.5c.3-1.3-.5-1.9-1.9-1.4Z"
      />
    </svg>
  );
}

export function GoogleLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5c-.3 1.5-1.2 2.8-2.5 3.7v3h4c2.4-2.2 3.5-5.4 3.5-8.8Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-4-3c-1.1.8-2.5 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.3v3.1C3.3 21.3 7.4 24 12 24Z" />
      <path fill="#FBBC05" d="M5.4 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.7.4-2.4V6.5H1.3C.5 8.2 0 10 0 12s.5 3.8 1.3 5.5l4.1-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C18 1.1 15.2 0 12 0 7.4 0 3.3 2.7 1.3 6.5l4.1 3.1C6.3 6.8 8.9 4.8 12 4.8Z" />
    </svg>
  );
}

export function AllGridIcon({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2.5" y="2.5" width="8" height="8" rx="2.2" fill="currentColor" />
      <rect x="13.5" y="2.5" width="8" height="8" rx="2.2" fill="currentColor" />
      <rect x="2.5" y="13.5" width="8" height="8" rx="2.2" fill="currentColor" />
      <rect x="13.5" y="13.5" width="8" height="8" rx="2.2" fill="currentColor" />
    </svg>
  );
}

export function SbpLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#5B57A2" />
      <text x="16" y="21" textAnchor="middle" fill="#fff" fontSize="9" fontWeight="800" fontFamily="system-ui,sans-serif">СБП</text>
    </svg>
  );
}

export function CardLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#1A73E8" />
      <rect x="6" y="9" width="20" height="14" rx="2" fill="#fff" />
      <rect x="6" y="12" width="20" height="4" fill="#1A1A1A" />
      <rect x="8" y="18.5" width="7" height="2" rx="1" fill="#C5CAD3" />
    </svg>
  );
}

export function OnixPayMark({ size = 28 }: { size?: number }) {
  return (
    <img
      src="/brand/onix-mark.png"
      width={size}
      height={size}
      alt=""
      draggable={false}
    />
  );
}
