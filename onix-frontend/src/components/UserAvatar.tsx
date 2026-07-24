import { useState } from 'react';

type UserAvatarProps = {
  avatarUrl?: string;
  /** When set, always load via same-origin proxy (ignores t.me CDN). */
  userId?: string;
  name: string;
  size?: 'small' | 'medium';
  /**
   * Presence pip on bottom-right of the avatar.
   * true = green (online), false = grey (offline).
   * Omit / undefined = no pip (system messages, etc.).
   */
  online?: boolean;
};

function initials(name: string): string {
  const value = name.replace(/^@/, '').trim();
  return value.slice(0, 2).toUpperCase() || '?';
}

function resolveAvatarSrc(avatarUrl: string | undefined, userId?: string): string | undefined {
  if (userId && /^\d+$/.test(userId)) {
    return `/api/avatars/${userId}`;
  }
  if (!avatarUrl) return undefined;
  const trimmed = avatarUrl.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('/api/avatars/')) return trimmed;

  try {
    const parsed = new URL(trimmed, typeof location !== 'undefined' ? location.origin : 'https://local.test');
    if (parsed.pathname.startsWith('/api/avatars/')) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    return undefined;
  }

  // Never hit t.me from the browser (RU timeouts).
  return undefined;
}

export default function UserAvatar({
  avatarUrl, userId, name, size = 'small', online,
}: UserAvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const usableUrl = resolveAvatarSrc(avatarUrl, userId);
  const showImage = Boolean(usableUrl && usableUrl !== failedUrl);
  const showPresence = online === true || online === false;

  return (
    <span
      className={[
        'user-avatar-wrap',
        size === 'medium' ? 'user-avatar-wrap--medium' : '',
        showPresence ? (online ? 'is-online' : 'is-offline') : '',
      ].filter(Boolean).join(' ')}
      data-online={showPresence ? (online ? 'true' : 'false') : undefined}
    >
      <span className={`user-avatar user-avatar--${size}`}>
        {showImage
          ? <img
            src={usableUrl}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailedUrl(usableUrl ?? null)}
          />
          : <span aria-hidden="true">{initials(name)}</span>}
      </span>
      {showPresence && <span className="user-avatar__presence" aria-hidden="true" />}
    </span>
  );
}
