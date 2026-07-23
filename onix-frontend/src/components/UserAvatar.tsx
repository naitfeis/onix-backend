import { useState } from 'react';

type UserAvatarProps = {
  avatarUrl?: string;
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

/** Telegram CDN often times out in RU without VPN — skip fetch, show initials. */
function isUnreliableAvatarHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 't.me' || host.endsWith('.t.me')
      || host === 'telegram.org' || host.endsWith('.telegram.org');
  } catch {
    return false;
  }
}

export default function UserAvatar({ avatarUrl, name, size = 'small', online }: UserAvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const usableUrl = avatarUrl && !isUnreliableAvatarHost(avatarUrl) ? avatarUrl : undefined;
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
