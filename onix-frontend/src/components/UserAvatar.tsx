import { useState } from 'react';

type UserAvatarProps = {
  avatarUrl?: string;
  name: string;
  size?: 'small' | 'medium';
};

function initials(name: string): string {
  const value = name.replace(/^@/, '').trim();
  return value.slice(0, 2).toUpperCase() || '?';
}

export default function UserAvatar({ avatarUrl, name, size = 'small' }: UserAvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(avatarUrl && avatarUrl !== failedUrl);

  return <span className={`user-avatar user-avatar--${size}`}>
    {showImage
      ? <img
        src={avatarUrl}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailedUrl(avatarUrl ?? null)}
      />
      : <span aria-hidden="true">{initials(name)}</span>}
  </span>;
}
