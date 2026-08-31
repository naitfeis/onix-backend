import { useState } from 'react';
import { buildApiUrl, resolveApiBase } from '../auth/apiConfig';

type UserAvatarProps = {
  avatarUrl?: string;
  /** When set, always load via same-origin proxy (ignores t.me CDN). */
  userId?: string;
  name: string;
  size?: 'small' | 'medium';
  onClick?: () => void;
  /**
   * Presence pip on bottom-right of the avatar.
   * true = green (online), false = grey (offline).
   * Omit / undefined = no pip (system messages, etc.).
   */
  online?: boolean;
};

/** Avoid repeating known-missing avatar requests across remounts and reloads. */
const FAILED_AVATARS_KEY = 'onix-avatar-miss';
const failedAvatarUrls = new Set<string>((() => {
  try {
    const raw = sessionStorage.getItem(FAILED_AVATARS_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
})());

function rememberFailedAvatar(url: string) {
  failedAvatarUrls.add(url);
  try {
    sessionStorage.setItem(FAILED_AVATARS_KEY, JSON.stringify([...failedAvatarUrls].slice(-80)));
  } catch { /* ignore */ }
}

function initials(name: string): string {
  const value = name.replace(/^@/, '').trim();
  return value.slice(0, 2).toUpperCase() || '?';
}

function extractAvatarUserId(avatarUrl: string | undefined, userId?: string): string | undefined {
  if (userId && /^\d+$/.test(userId)) return userId;
  if (!avatarUrl) return undefined;
  const trimmed = avatarUrl.trim();
  const relative = trimmed.match(/^\/api\/avatars\/(\d+)(?:\?|$)/);
  if (relative) return relative[1];
  try {
    const parsed = new URL(trimmed, typeof location !== 'undefined' ? location.origin : 'https://local.test');
    const fromPath = parsed.pathname.match(/^\/api\/avatars\/(\d+)$/);
    if (fromPath) return fromPath[1];
  } catch {
    /* ignore */
  }
  return undefined;
}

function resolveAvatarSrc(avatarUrl: string | undefined, userId?: string): string | undefined {
  const id = extractAvatarUserId(avatarUrl, userId);
  if (id) {
    // Same-origin relative path (Vercel rewrite / Vite proxy → API).
    return buildApiUrl(`/api/avatars/${id}`, resolveApiBase());
  }
  return undefined;
}

export default function UserAvatar({
  avatarUrl, userId, name, size = 'small', online, onClick,
}: UserAvatarProps) {
  const usableUrl = resolveAvatarSrc(avatarUrl, userId);
  const [failedUrl, setFailedUrl] = useState<string | null>(
    () => (usableUrl && failedAvatarUrls.has(usableUrl) ? usableUrl : null),
  );
  const showImage = Boolean(
    usableUrl && usableUrl !== failedUrl && !failedAvatarUrls.has(usableUrl),
  );
  const showPresence = online === true || online === false;

  const className = [
    'user-avatar-wrap',
    size === 'medium' ? 'user-avatar-wrap--medium' : '',
    showPresence ? (online ? 'is-online' : 'is-offline') : '',
    onClick ? 'user-avatar-wrap--button' : '',
  ].filter(Boolean).join(' ');
  const body = (
    <>
      <span className={`user-avatar user-avatar--${size}`}>
        {showImage
          ? <img
            src={usableUrl}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={(event) => {
              if (event.currentTarget.naturalWidth === 0 && usableUrl) {
                rememberFailedAvatar(usableUrl);
                setFailedUrl(usableUrl);
              }
            }}
            onError={() => {
              if (usableUrl) rememberFailedAvatar(usableUrl);
              setFailedUrl(usableUrl ?? null);
            }}
          />
          : <span aria-hidden="true">{initials(name)}</span>}
      </span>
      {showPresence && <span className="user-avatar__presence" aria-hidden="true" />}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={className}
        data-online={showPresence ? (online ? 'true' : 'false') : undefined}
        onClick={onClick}
        aria-label={`Профиль ${name}`}
      >
        {body}
      </button>
    );
  }

  return (
    <span
      className={className}
      data-online={showPresence ? (online ? 'true' : 'false') : undefined}
    >
      {body}
    </span>
  );
}
