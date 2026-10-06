import type { ReactNode } from 'react';
import UserAvatar from '../UserAvatar';
import { money } from '../../api/client';

type BalancePillProps = {
  avatarUrl?: string;
  userId?: string;
  username: string;
  balanceCents: string;
  online?: boolean;
  onClick?: () => void;
  children?: ReactNode;
};

/** Desktop balance capsule: avatar, presence dot and formatted money. */
export default function BalancePill({
  avatarUrl, userId, username, balanceCents, online = true, onClick, children,
}: BalancePillProps) {
  const content = (
    <>
      <UserAvatar avatarUrl={avatarUrl} userId={userId} name={username} size="small" online={online} />
      <strong>{money(balanceCents)}</strong>
      {children}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="user-summary balance-pill" onClick={onClick} aria-label="Баланс">
        {content}
      </button>
    );
  }
  return <span className="user-summary balance-pill">{content}</span>;
}
