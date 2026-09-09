import type { WalletOperation } from '../api/contracts';

type LedgerIconKind =
  | 'REFUND'
  | 'PURCHASE_HOLD'
  | 'WITHDRAWAL'
  | 'DEPOSIT'
  | 'DEPOSIT_FUND'
  | 'DEPOSIT_RETURN'
  | 'SALE_PAYOUT'
  | 'ADMIN_ADJUSTMENT'
  | 'DEFAULT';

function kindFor(type: string): LedgerIconKind {
  if (
    type === 'REFUND'
    || type === 'PURCHASE_HOLD'
    || type === 'WITHDRAWAL'
    || type === 'DEPOSIT'
    || type === 'DEPOSIT_FUND'
    || type === 'DEPOSIT_RETURN'
    || type === 'SALE_PAYOUT'
    || type === 'ADMIN_ADJUSTMENT'
  ) {
    return type;
  }
  return 'DEFAULT';
}

function Glyph({ kind }: { kind: LedgerIconKind }) {
  if (kind === 'REFUND') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M7 17L17 7M17 7H10M17 7v7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (kind === 'PURCHASE_HOLD') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 6h2l2.2 9.2a1.5 1.5 0 0 0 1.5 1.2h7.6a1.5 1.5 0 0 0 1.5-1.2L21 8H7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="10" cy="19.5" r="1.3" fill="currentColor" />
        <circle cx="17.5" cy="19.5" r="1.3" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'WITHDRAWAL') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="7" cy="12" r="1.7" fill="currentColor" />
        <circle cx="12" cy="12" r="1.7" fill="currentColor" />
        <circle cx="17" cy="12" r="1.7" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'DEPOSIT' || kind === 'DEPOSIT_FUND' || kind === 'DEPOSIT_RETURN' || kind === 'SALE_PAYOUT') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 5v14M5 12h14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function LedgerOpIcon({ type }: { type: WalletOperation['type'] | string }) {
  const kind = kindFor(type);
  return (
    <span className={`ledger-op-icon ledger-op-icon--${kind.toLowerCase().replace(/_/g, '-')}`} aria-hidden="true">
      <Glyph kind={kind} />
    </span>
  );
}
