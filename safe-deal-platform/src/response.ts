import { PlatformStatus, Prisma } from '@prisma/client';
import { clientAvatarUrl } from './avatars/avatar-url';
import { AuthUser } from './common';
import { formatOnixId } from './onix-id';
import { statusBadge, type PlatformStatusCode } from './platform-status';
import { publicDisplayName } from './public-username';
import { canLeaveReview } from './marketplace/review-policy';
import { formatWarranty } from './marketplace/warranty';

type PublicUser = {
  id: bigint;
  onixId: string;
  telegramNick?: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  ratingAverage: Prisma.Decimal;
  ratingCount: number;
  completedSales: number;
  lastSeenAt: Date;
  isAdmin?: boolean;
  isSupport?: boolean;
  platformStatus?: PlatformStatus;
  _count?: { followers: number };
};

export type StatusBadge = PlatformStatusCode;

export interface ProfileDto {
  id: string;
  onixId: string;
  username: string;
  avatarUrl?: string;
  bio?: string;
  rating: number;
  reviewCount: number;
  salesCount: number;
  followersCount: number;
  lastOnline: string;
  isAdmin: boolean;
  /** Primary platform status — always present, default USER. */
  status: PlatformStatusCode;
  /** Backward-compatible roles list derived from status. */
  roles: PlatformStatusCode[];
  balanceCents: string;
  /** Buyer funds currently held in open orders. */
  heldInOrdersCents?: string;
  walletHistory: LedgerDto[];
  /** Account creation time — used for new-seller warranty floor. */
  registeredAt?: string;
  /** Additive Stage 1 — owner deposit after lazy unlock. */
  deposit?: {
    availableCents: string;
    lockedCents: string;
    totalCents: string;
  };
  /** Additive Stage 1 — public trust card shape (never trustScore). */
  trustCard?: import('./economy/trust/trust-card').PublicTrustCard;
  /** Selling requires a linked Telegram account. */
  canSell?: boolean;
  hasTelegram?: boolean;
  hasGoogle?: boolean;
}

export interface LedgerDto {
  id: string;
  type: 'DEPOSIT' | 'PURCHASE_HOLD' | 'REFUND' | 'SALE_PAYOUT' | 'ADMIN_ADJUSTMENT' | 'CLAWBACK' | 'WITHDRAWAL' | 'DEPOSIT_FUND' | 'DEPOSIT_RETURN';
  amountCents: string;
  /** API contract: LedgerEntry has no DB status; posted entries are always COMPLETED. */
  status: 'COMPLETED';
  createdAt: string;
}

export interface ProductDto {
  id: string;
  /** Public short code number for ONIXLOT-{n}. */
  lotNumber?: number;
  title: string;
  description?: string;
  priceCents: string;
  quantity: number;
  category: string;
  subcategory?: string;
  status: string;
  autoDeliver?: boolean;
  seller: ReturnType<typeof sellerDto>;
  favorite: boolean;
  createdAt: string;
  /** Unique views — only for the listing owner. */
  viewCount?: number;
  warrantyHours?: number;
  warrantyLabel?: string;
}

function resolveStatus(user: Pick<PublicUser, 'platformStatus' | 'isAdmin' | 'isSupport'>): PlatformStatus {
  if (user.platformStatus) return user.platformStatus;
  if (user.isAdmin) return 'ADMIN';
  if (user.isSupport) return 'MODERATOR';
  return 'USER';
}

function statusIsAdmin(status: PlatformStatus, isAdminFlag: boolean): boolean {
  return status === 'ADMIN' || status === 'SUPER_ADMIN' || isAdminFlag;
}

export function sellerDto(user: PublicUser & { followers?: Array<{ followerId: bigint }> }) {
  const status = resolveStatus(user);
  const badge = statusBadge(status);
  const onixId = formatOnixId(user.onixId);
  return {
    id: user.id.toString(),
    onixId,
    // Public label: displayName only (never Telegram @username / telegramId).
    username: publicDisplayName(user.displayName, onixId),
    avatarUrl: clientAvatarUrl(user.id, user.avatarUrl),
    rating: Number(user.ratingAverage),
    reviewCount: user.ratingCount,
    salesCount: user.completedSales,
    followersCount: user._count?.followers ?? 0,
    lastOnline: user.lastSeenAt.toISOString(),
    status,
    // Present when marketplace includes viewer-scoped Follow rows (take: 1).
    followed: Boolean(user.followers?.length),
    ...(badge ? { badge } : {}),
  };
}

export function profileDto(
  user: PublicUser & {
    balanceCents: bigint;
    isAdmin: boolean;
    isSupport?: boolean;
    bio?: string | null;
    createdAt?: Date;
  },
  ledger: Array<{ id: bigint; type: string; amountCents: bigint; createdAt: Date }>,
): ProfileDto {
  const status = resolveStatus(user);
  return {
    ...sellerDto(user),
    ...(user.bio ? { bio: user.bio } : {}),
    ...(user.createdAt ? { registeredAt: user.createdAt.toISOString() } : {}),
    balanceCents: user.balanceCents.toString(),
    isAdmin: statusIsAdmin(status, user.isAdmin),
    status,
    roles: [status],
    walletHistory: ledger.map(ledgerDto),
  };
}

export function ledgerDto(entry: { id: bigint; type: string; amountCents: bigint; createdAt: Date }): LedgerDto {
  return {
    id: entry.id.toString(),
    type: entry.type as LedgerDto['type'],
    amountCents: entry.amountCents.toString(),
    status: 'COMPLETED',
    createdAt: entry.createdAt.toISOString(),
  };
}

export function productDto(product: {
  id: string;
  lotNumber?: number;
  title: string;
  description?: string | null;
  priceCents: bigint;
  quantity: number;
  category: string;
  subcategory: string | null;
  status: string;
  autoDeliver?: boolean;
  createdAt: Date;
  sellerId?: bigint;
  seller: PublicUser;
  favorites?: Array<{ userId: bigint }>;
  _count?: { viewUniques?: number };
  warrantyHours?: number | null;
}, viewerId?: bigint): ProductDto {
  const ownerId = product.sellerId ?? product.seller.id;
  const isOwner = viewerId != null && ownerId === viewerId;
  const warrantyHours = product.warrantyHours ?? 10;
  return {
    id: product.id,
    ...(product.lotNumber != null ? { lotNumber: product.lotNumber } : {}),
    title: product.title,
    // Always emit when present (incl. empty) so detail load ≠ lean list omit.
    ...(product.description !== undefined && product.description !== null
      ? { description: product.description }
      : {}),
    priceCents: product.priceCents.toString(),
    quantity: product.quantity,
    category: product.category,
    ...(product.subcategory ? { subcategory: product.subcategory } : {}),
    status: product.status,
    autoDeliver: Boolean(product.autoDeliver),
    seller: sellerDto(product.seller),
    favorite: Boolean(viewerId && product.favorites?.some((item) => item.userId === viewerId)),
    createdAt: product.createdAt.toISOString(),
    ...(isOwner && product._count?.viewUniques != null
      ? { viewCount: product._count.viewUniques }
      : {}),
    warrantyHours,
    warrantyLabel: formatWarranty(warrantyHours),
  };
}

export function dealDto(order: {
  id: bigint;
  buyerId: bigint;
  sellerId: bigint;
  totalAmountCents: bigint;
  status: string;
  createdAt: Date;
  updatedAt?: Date;
  completedAt?: Date | null;
  transitions?: Array<{ to: string; createdAt: Date; actorId?: bigint | null; reason?: string | null }>;
  product: {
    id: string;
    title: string;
    category: string;
    subcategory?: string | null;
    autoDeliver?: boolean;
    warrantyHours?: number | null;
  };
  buyer: PublicUser;
  seller: PublicUser;
  reviews: Array<{ authorId: bigint }>;
  chat?: { id: string } | null;
  supportTickets?: Array<{ id: string; status?: string; chatId?: string }>;
  dispute?: {
    orderId: string;
    status: 'REVIEWING' | 'RESOLVED';
    statusLabel: string;
    supportLabel: string;
    queuePosition: number | null;
    queueTotal: number;
    avgWaitMinutes: number | null;
  } | null;
}, viewer: AuthUser) {
  const buyer = order.buyerId === viewer.id;
  const warrantyHours = order.product.warrantyHours ?? 10;
  const deliveredAt = order.transitions?.find((item) => item.to === 'DELIVERING')?.createdAt
    ?? (order.status === 'DELIVERING' || order.status === 'COMPLETED'
      ? (order.completedAt ?? order.updatedAt ?? null)
      : null);
  const warrantyEndsAt = deliveredAt
    ? new Date(deliveredAt.getTime() + warrantyHours * 3_600_000).toISOString()
    : null;
  const refunded = [...(order.transitions ?? [])].find((item) => item.to === 'REFUNDED');
  const completed = [...(order.transitions ?? [])].find((item) => item.to === 'COMPLETED');
  const refundKind = refunded
    ? (refunded.actorId === order.sellerId ? 'SELLER' as const : 'ADMIN' as const)
    : null;
  const payoutKind = completed
    ? (completed.actorId === order.buyerId ? 'BUYER' as const : 'ADMIN' as const)
    : null;
  const OPEN_TICKET_STATUSES = new Set(['OPEN', 'IN_REVIEW', 'WAITING_USER']);
  const complaintOpen = Boolean(
    order.supportTickets?.some((ticket) => OPEN_TICKET_STATUSES.has(ticket.status ?? 'OPEN')),
  );
  return {
    id: order.id.toString(),
    product: {
      id: order.product.id,
      title: order.product.title,
      category: order.product.category,
      ...(order.product.subcategory ? { subcategory: order.product.subcategory } : {}),
      autoDeliver: Boolean(order.product.autoDeliver),
      warrantyHours,
    },
    totalAmountCents: order.totalAmountCents.toString(),
    status: order.status,
    warrantyHours,
    warrantyEndsAt,
    refundKind,
    payoutKind,
    role: buyer ? 'buyer' as const : 'seller' as const,
    counterparty: sellerDto(buyer ? order.seller : order.buyer),
    createdAt: order.createdAt.toISOString(),
    canReview: canLeaveReview({
      status: order.status,
      buyerId: order.buyerId,
      authorId: viewer.id,
      totalAmountCents: order.totalAmountCents,
    }) && !order.reviews.some((review) => review.authorId === viewer.id),
    complaintOpen,
    ...(order.chat?.id ? { chatId: order.chat.id } : {}),
    ...(order.dispute ? { dispute: order.dispute } : {}),
  };
}

export function messageDto(message: {
  id: bigint;
  chatId: string;
  senderId: bigint | null;
  kind?: string;
  text: string;
  createdAt: Date;
  deletedAt?: Date | null;
  deletedById?: bigint | null;
  deletedReason?: string | null;
  sender: Pick<PublicUser, 'id' | 'onixId' | 'telegramNick' | 'displayName' | 'avatarUrl' | 'isAdmin' | 'isSupport' | 'platformStatus'> | null;
}, viewerId: bigint, opts?: {
  staffViewer?: boolean;
  /** Other members' lastReadAt for receipts */
  memberReads?: Array<{
    userId: bigint;
    onixId: string;
    username: string;
    lastReadAt: Date | null;
  }>;
}) {
  const system = message.kind === 'SYSTEM' || message.senderId == null;
  const sender = message.sender;
  const staffBadge = !system && sender ? statusBadge(resolveStatus(sender)) : undefined;
  const mine = !system && message.senderId === viewerId;
  const deleted = Boolean(message.deletedAt);
  const staffViewer = Boolean(opts?.staffViewer);
  const showOriginal = !deleted || staffViewer;
  const memberReads = opts?.memberReads ?? [];
  const readers = !system
    ? memberReads
      .filter((m) => m.userId !== message.senderId && m.lastReadAt && m.lastReadAt >= message.createdAt)
      .map((m) => ({
        onixId: formatOnixId(m.onixId),
        username: m.username,
        readAt: m.lastReadAt!.toISOString(),
      }))
    : [];
  const deliveryStatus: 'SENT' | 'READ' | undefined = system || !mine
    ? undefined
    : (readers.length > 0 ? 'READ' : 'SENT');

  return {
    id: message.id.toString(),
    threadId: message.chatId,
    kind: system ? 'SYSTEM' as const : 'USER' as const,
    sender: {
      id: system ? '0' : sender!.id.toString(),
      username: system ? 'ONIX' : publicDisplayName(sender!.displayName, formatOnixId(sender!.onixId)),
      ...(system ? {} : { avatarUrl: clientAvatarUrl(sender!.id, sender!.avatarUrl) }),
      ...(staffBadge ? { badge: staffBadge } : {}),
    },
    text: showOriginal ? message.text : 'Сообщение удалено',
    createdAt: message.createdAt.toISOString(),
    mine,
    ...(deliveryStatus ? { deliveryStatus } : {}),
    ...(deleted ? {
      deleted: true,
      ...(staffViewer ? {
        deletedAt: message.deletedAt!.toISOString(),
        deletedReason: message.deletedReason ?? null,
        originalText: message.text,
      } : {}),
    } : {}),
    // Staff always; sender also gets readBy so founder UI can show «прочитано HH:MM»
    // even if auth.isAdmin is briefly out of sync with platformStatus.
    ...((staffViewer || mine) && readers.length > 0 ? { readBy: readers } : {}),
  };
}

export function notificationDto(item: {
  id: bigint; title: string; body: string; readAt: Date | null; createdAt: Date;
  type?: string;
  data?: unknown;
}) {
  const payload = item.data && typeof item.data === 'object' && !Array.isArray(item.data)
    ? item.data as { chatId?: unknown; orderId?: unknown }
    : null;
  const chatId = typeof payload?.chatId === 'string' && payload.chatId ? payload.chatId : null;
  const orderId = typeof payload?.orderId === 'string' && payload.orderId ? payload.orderId : null;
  return {
    id: item.id.toString(),
    title: item.title,
    body: item.body,
    read: Boolean(item.readAt),
    createdAt: item.createdAt.toISOString(),
    ...(item.type ? { type: item.type } : {}),
    ...(chatId ? { chatId } : {}),
    ...(orderId ? { orderId } : {}),
  };
}

export function reviewDto(item: {
  id: bigint;
  rating: number;
  text: string | null;
  createdAt: Date;
  author: Pick<PublicUser, 'id' | 'onixId' | 'telegramNick' | 'displayName' | 'avatarUrl' | 'isAdmin' | 'isSupport' | 'platformStatus'>;
  order?: {
    totalAmountCents: bigint;
    product: { title: string };
  } | null;
}) {
  const badge = statusBadge(resolveStatus(item.author));
  const onixId = formatOnixId(item.author.onixId);
  return {
    id: item.id.toString(),
    author: {
      id: item.author.id.toString(),
      onixId,
      username: publicDisplayName(item.author.displayName, onixId),
      avatarUrl: clientAvatarUrl(item.author.id, item.author.avatarUrl),
      ...(badge ? { badge } : {}),
    },
    rating: item.rating,
    text: item.text ?? '',
    createdAt: item.createdAt.toISOString(),
    ...(item.order ? {
      productTitle: item.order.product.title,
      totalAmountCents: item.order.totalAmountCents.toString(),
    } : {}),
  };
}
