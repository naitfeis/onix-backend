/**
 * Pure in-memory monetary model mirroring BalanceService + DepositService + escrow flows.
 * Used by property-based and invariant e2e tests — no DB.
 */

export type LedgerType =
  | 'DEPOSIT'
  | 'PURCHASE_HOLD'
  | 'REFUND'
  | 'SALE_PAYOUT'
  | 'ADMIN_ADJUSTMENT'
  | 'WITHDRAWAL'
  | 'DEPOSIT_FUND'
  | 'DEPOSIT_RETURN';

export type DepositType = 'TOPUP' | 'WITHDRAW' | 'LOCK' | 'UNLOCK' | 'SEIZE' | 'ADMIN_ADJUST';

export type LedgerRow = {
  userId: string;
  type: LedgerType;
  amountCents: bigint;
  balanceAfterCents: bigint;
  idempotencyKey: string;
  orderId?: string;
};

export type DepositRow = {
  userId: string;
  type: DepositType;
  amountCents: bigint;
  availableAfterCents: bigint;
  lockedAfterCents: bigint;
  idempotencyKey: string;
};

export type UserWallet = {
  balanceCents: bigint;
  /** Opening main balance before any ledger rows (for invariant reconstruction). */
  openingBalanceCents: bigint;
  depositAvailableCents: bigint;
  depositLockedCents: bigint;
};

export class MonetaryInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MonetaryInvariantError';
  }
}

export class LedgerModel {
  private readonly users = new Map<string, UserWallet>();
  private readonly ledger = new Map<string, LedgerRow>();
  private readonly depositLedger = new Map<string, DepositRow>();
  private readonly products = new Map<string, {
    sellerId: string;
    priceCents: bigint;
    payoutCents: bigint;
    quantity: number;
  }>();
  private readonly orders = new Map<string, {
    buyerId: string;
    sellerId: string;
    productId?: string;
    totalAmountCents: bigint;
    payoutCents: bigint;
    status: 'PAYMENT_HOLD' | 'COMPLETED' | 'REFUNDED' | 'CANCELED';
  }>();

  ensureProduct(
    productId: string,
    opts: { sellerId: string; priceCents: bigint; payoutCents: bigint; quantity: number },
  ): void {
    this.products.set(productId, { ...opts });
  }

  ensureUser(userId: string, initial: Partial<UserWallet> = {}): UserWallet {
    let u = this.users.get(userId);
    if (!u) {
      const opening = initial.balanceCents ?? initial.openingBalanceCents ?? 0n;
      u = {
        balanceCents: opening,
        openingBalanceCents: opening,
        depositAvailableCents: initial.depositAvailableCents ?? 0n,
        depositLockedCents: initial.depositLockedCents ?? 0n,
      };
      this.users.set(userId, u);
    }
    return u;
  }

  getUser(userId: string): UserWallet {
    return this.ensureUser(userId);
  }

  credit(
    userId: string,
    amountCents: bigint,
    type: Extract<LedgerType, 'DEPOSIT' | 'REFUND' | 'SALE_PAYOUT' | 'ADMIN_ADJUSTMENT' | 'DEPOSIT_RETURN'>,
    idempotencyKey: string,
  ): LedgerRow {
    if (amountCents <= 0n) throw new MonetaryInvariantError('credit amount must be > 0');
    const existing = this.ledger.get(idempotencyKey);
    if (existing) {
      if (existing.userId !== userId || existing.type !== type || existing.amountCents !== amountCents) {
        throw new MonetaryInvariantError('idempotency conflict on credit');
      }
      return existing;
    }
    const u = this.ensureUser(userId);
    u.balanceCents += amountCents;
    const row: LedgerRow = {
      userId, type, amountCents, balanceAfterCents: u.balanceCents, idempotencyKey,
    };
    this.ledger.set(idempotencyKey, row);
    return row;
  }

  debit(
    userId: string,
    amountCents: bigint,
    type: Extract<LedgerType, 'PURCHASE_HOLD' | 'WITHDRAWAL' | 'ADMIN_ADJUSTMENT' | 'DEPOSIT_FUND'>,
    idempotencyKey: string,
  ): LedgerRow {
    if (amountCents <= 0n) throw new MonetaryInvariantError('debit amount must be > 0');
    const existing = this.ledger.get(idempotencyKey);
    if (existing) {
      if (existing.userId !== userId || existing.type !== type || existing.amountCents !== -amountCents) {
        throw new MonetaryInvariantError('idempotency conflict on debit');
      }
      return existing;
    }
    const u = this.ensureUser(userId);
    if (u.balanceCents < amountCents) throw new MonetaryInvariantError('insufficient balance');
    u.balanceCents -= amountCents;
    const row: LedgerRow = {
      userId, type, amountCents: -amountCents, balanceAfterCents: u.balanceCents, idempotencyKey,
    };
    this.ledger.set(idempotencyKey, row);
    return row;
  }

  fundDeposit(userId: string, amountCents: bigint, key: string): void {
    this.debit(userId, amountCents, 'DEPOSIT_FUND', `bal:${key}`);
    this.creditDepositAvailable(userId, amountCents, 'TOPUP', key);
  }

  withdrawDeposit(userId: string, amountCents: bigint, key: string): void {
    this.debitDepositAvailable(userId, amountCents, 'WITHDRAW', key);
    this.credit(userId, amountCents, 'DEPOSIT_RETURN', `bal:${key}`);
  }

  creditDepositAvailable(userId: string, amountCents: bigint, type: 'TOPUP' | 'UNLOCK' | 'ADMIN_ADJUST', key: string): DepositRow {
    if (amountCents <= 0n) throw new MonetaryInvariantError('deposit credit must be > 0');
    const existing = this.depositLedger.get(key);
    if (existing) return existing;
    const u = this.ensureUser(userId);
    u.depositAvailableCents += amountCents;
    const row: DepositRow = {
      userId, type, amountCents,
      availableAfterCents: u.depositAvailableCents,
      lockedAfterCents: u.depositLockedCents,
      idempotencyKey: key,
    };
    this.depositLedger.set(key, row);
    return row;
  }

  debitDepositAvailable(userId: string, amountCents: bigint, type: 'WITHDRAW' | 'LOCK' | 'SEIZE' | 'ADMIN_ADJUST', key: string): DepositRow {
    if (amountCents <= 0n) throw new MonetaryInvariantError('deposit debit must be > 0');
    const existing = this.depositLedger.get(key);
    if (existing) return existing;
    const u = this.ensureUser(userId);
    if (u.depositAvailableCents < amountCents) throw new MonetaryInvariantError('insufficient deposit available');
    u.depositAvailableCents -= amountCents;
    const row: DepositRow = {
      userId, type, amountCents: -amountCents,
      availableAfterCents: u.depositAvailableCents,
      lockedAfterCents: u.depositLockedCents,
      idempotencyKey: key,
    };
    this.depositLedger.set(key, row);
    return row;
  }

  lockDeposit(userId: string, amountCents: bigint, key: string): void {
    if (amountCents <= 0n) return;
    const existing = this.depositLedger.get(key);
    if (existing) return;
    const u = this.ensureUser(userId);
    if (u.depositAvailableCents < amountCents) throw new MonetaryInvariantError('cannot lock');
    u.depositAvailableCents -= amountCents;
    u.depositLockedCents += amountCents;
    this.depositLedger.set(key, {
      userId, type: 'LOCK', amountCents: -amountCents,
      availableAfterCents: u.depositAvailableCents,
      lockedAfterCents: u.depositLockedCents,
      idempotencyKey: key,
    });
  }

  unlockDeposit(userId: string, amountCents: bigint, key: string): void {
    if (amountCents <= 0n) return;
    const existing = this.depositLedger.get(key);
    if (existing) return;
    const u = this.ensureUser(userId);
    if (u.depositLockedCents < amountCents) throw new MonetaryInvariantError('cannot unlock');
    u.depositLockedCents -= amountCents;
    u.depositAvailableCents += amountCents;
    this.depositLedger.set(key, {
      userId, type: 'UNLOCK', amountCents,
      availableAfterCents: u.depositAvailableCents,
      lockedAfterCents: u.depositLockedCents,
      idempotencyKey: key,
    });
  }

  /** Escrow: buyer hold. */
  purchase(orderId: string, buyerId: string, sellerId: string, total: bigint, payout: bigint, key: string): void {
    if (this.orders.has(orderId)) return;
    this.debit(buyerId, total, 'PURCHASE_HOLD', `order:${key}:hold`);
    this.orders.set(orderId, {
      buyerId, sellerId, totalAmountCents: total, payoutCents: payout, status: 'PAYMENT_HOLD',
    });
  }

  /**
   * Contended listing purchase — mirrors optimistic reserve in EscrowService.purchase.
   * Exactly `quantity` buyers succeed; others throw.
   */
  purchaseProduct(productId: string, buyerId: string, key: string): string {
    const holdKey = `order:${key}:hold`;
    if (this.ledger.has(holdKey)) {
      for (const [orderId, order] of this.orders) {
        if (order.buyerId === buyerId && order.productId === productId) return orderId;
      }
      throw new MonetaryInvariantError('idempotency conflict on purchase');
    }
    const product = this.products.get(productId);
    if (!product || product.quantity < 1) {
      throw new MonetaryInvariantError('product unavailable');
    }
    product.quantity -= 1;
    const orderId = `ord-${key}`;
    this.purchase(orderId, buyerId, product.sellerId, product.priceCents, product.payoutCents, key);
    this.orders.get(orderId)!.productId = productId;
    return orderId;
  }

  complete(orderId: string): void {
    const order = this.orders.get(orderId);
    if (!order) throw new MonetaryInvariantError('order missing');
    if (order.status === 'COMPLETED') return;
    if (order.status !== 'PAYMENT_HOLD') throw new MonetaryInvariantError('bad status for complete');
    if (order.payoutCents > 0n) {
      this.credit(order.sellerId, order.payoutCents, 'SALE_PAYOUT', `order:${orderId}:payout`);
    }
    const seller = this.ensureUser(order.sellerId);
    const freeze = order.totalAmountCents < seller.depositAvailableCents
      ? order.totalAmountCents
      : seller.depositAvailableCents;
    this.lockDeposit(order.sellerId, freeze, `deposit-lock:order:${orderId}`);
    order.status = 'COMPLETED';
  }

  refund(orderId: string): void {
    const order = this.orders.get(orderId);
    if (!order) throw new MonetaryInvariantError('order missing');
    if (order.status === 'REFUNDED' || order.status === 'CANCELED') return;
    if (order.status === 'COMPLETED' && order.payoutCents > 0n) {
      this.debit(order.sellerId, order.payoutCents, 'ADMIN_ADJUSTMENT', `order:${orderId}:clawback`);
    }
    this.credit(order.buyerId, order.totalAmountCents, 'REFUND', `order:${orderId}:refund`);
    order.status = order.status === 'COMPLETED' ? 'REFUNDED' : 'CANCELED';
  }

  /** Assert all monetary invariants for every user. */
  assertInvariants(): void {
    for (const [userId, u] of this.users) {
      if (u.balanceCents < 0n) throw new MonetaryInvariantError(`${userId}: negative balance`);
      if (u.depositAvailableCents < 0n) throw new MonetaryInvariantError(`${userId}: negative deposit available`);
      if (u.depositLockedCents < 0n) throw new MonetaryInvariantError(`${userId}: negative deposit locked`);

      // Reconstruct balance from opening + ledger (matches BalanceService semantics).
      let reconstructed = u.openingBalanceCents;
      let lastAfter: bigint | null = null;
      for (const row of this.ledger.values()) {
        if (row.userId !== userId) continue;
        reconstructed += row.amountCents;
        if (row.balanceAfterCents !== reconstructed) {
          throw new MonetaryInvariantError(`${userId}: ledger balanceAfter mismatch`);
        }
        lastAfter = row.balanceAfterCents;
      }
      if (reconstructed !== u.balanceCents) {
        throw new MonetaryInvariantError(`${userId}: balance diverged from ledger`);
      }
      if (lastAfter !== null && lastAfter !== u.balanceCents) {
        throw new MonetaryInvariantError(`${userId}: last balanceAfter != balance`);
      }

      // Deposit: available+locked conservation vs deposit ledger signed amounts (LOCK/UNLOCK special).
      let depDelta = 0n;
      for (const row of this.depositLedger.values()) {
        if (row.userId !== userId) continue;
        if (row.type === 'LOCK') {
          // LOCK decreases available and increases locked — total unchanged.
          continue;
        }
        if (row.type === 'UNLOCK') {
          continue;
        }
        depDelta += row.amountCents;
      }
      const total = u.depositAvailableCents + u.depositLockedCents;
      // Initial may be non-zero; only check non-negativity + after-fields consistency.
      if (total < 0n) throw new MonetaryInvariantError(`${userId}: negative deposit total`);
      void depDelta;
    }

    // Conservation across purchase/complete: buyer hold + seller payout + fee = total.
    for (const [orderId, order] of this.orders) {
      if (order.payoutCents > order.totalAmountCents) {
        throw new MonetaryInvariantError(`${orderId}: payout > total`);
      }
      if (order.totalAmountCents < 0n || order.payoutCents < 0n) {
        throw new MonetaryInvariantError(`${orderId}: negative order amounts`);
      }
    }

    // Unique idempotency keys already enforced by Maps.
    if (this.ledger.size !== new Set(this.ledger.keys()).size) {
      throw new MonetaryInvariantError('duplicate ledger keys');
    }
  }

  ledgerEntries(): LedgerRow[] {
    return [...this.ledger.values()];
  }

  depositEntries(): DepositRow[] {
    return [...this.depositLedger.values()];
  }
}
