import { PlatformStatus, Prisma } from '@prisma/client';
import { AuthUser } from './common';
import { formatOnixId } from './onix-id';
import { statusBadge, type PlatformStatusCode } from './platform-status';
import { publicDisplayName } from './public-username';

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
  walletHistory: LedgerDto[];
  /** Additive Stage 1 — owner deposit after lazy unlock. */
  deposit?: {
    availableCents: string;
    lockedCents: string;
    totalCents: string;
  };
  /** Additive Stage 1 — public trust card shape (never trustScore). */
  trustCard?: import('./economy/trust/trust-card').PublicTrustCard;
}

export interface LedgerDto {
  id: string;
  type: 'DEPOSIT' | 'PURCHASE_HOLD' | 'REFUND' | 'SALE_PAYOUT' | 'ADMIN_ADJUSTMENT' | 'WITHDRAWAL' | 'DEPOSIT_FUND' | 'DEPOSIT_RETURN';
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
}

function resolveStatus(user: Pick<PublicUser, 'platformStatus' | 'isAdmin' | 'isSupport'>): PlatformStatus {
  if (user.platformStatus) return user.platformStatus;
  if (user.isAdmin) return 'ADMIN';
  if (user.isSupport) return 'MODERATOR';
  return 'USER';
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
    ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
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
  },
  ledger: Array<{ id: bigint; type: string; amountCents: bigint; createdAt: Date }>,
): ProfileDto {
  const status = resolveStatus(user);
  return {
    ...sellerDto(user),
    ...(user.bio ? { bio: user.bio } : {}),
    balanceCents: user.balanceCents.toString(),
    isAdmin: status === 'ADMIN' || user.isAdmin,
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
}, viewerId?: bigint): ProductDto {
  const ownerId = product.sellerId ?? product.seller.id;
  const isOwner = viewerId != null && ownerId === viewerId;
  return {
    id: product.id,
    ...(product.lotNumber != null ? { lotNumber: product.lotNumber } : {}),
    title: product.title,
    ...(product.description ? { description: product.description } : {}),
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
  };
}

export function dealDto(order: {
  id: bigint;
  buyerId: bigint;
  sellerId: bigint;
  totalAmountCents: bigint;
  status: string;
  createdAt: Date;
  product: { id: string; title: string; category: string };
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
  const hasTicket = Boolean(order.supportTickets?.length);
  const complaintOpen = hasTicket
    || order.status === 'DISPUTE'
    || order.status === 'REFUNDED'
    || order.status === 'CANCELED';
  return {
    id: order.id.toString(),
    product: order.product,
    totalAmountCents: order.totalAmountCents.toString(),
    status: order.status,
    role: buyer ? 'buyer' as const : 'seller' as const,
    counterparty: sellerDto(buyer ? order.seller : order.buyer),
    createdAt: order.createdAt.toISOString(),
    canReview: order.status === 'COMPLETED'
      && buyer
      && order.totalAmountCents > 0n
      && !order.reviews.some((review) => review.authorId === viewer.id),
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
      ...(system ? {} : (sender!.avatarUrl ? { avatarUrl: sender!.avatarUrl } : {})),
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
    ...(staffViewer && readers.length > 0 ? { readBy: readers } : {}),
  };
}

export function notificationDto(item: {
  id: bigint; title: string; body: string; readAt: Date | null; createdAt: Date;
}) {
  return {
    id: item.id.toString(),
    title: item.title,
    body: item.body,
    read: Boolean(item.readAt),
    createdAt: item.createdAt.toISOString(),
  };
}

export function reviewDto(item: {
  id: bigint;
  rating: number;
  text: string | null;
  createdAt: Date;
  author: Pick<PublicUser, 'id' | 'onixId' | 'telegramNick' | 'displayName' | 'avatarUrl' | 'isAdmin' | 'isSupport' | 'platformStatus'>;
}) {
  const badge = statusBadge(resolveStatus(item.author));
  const onixId = formatOnixId(item.author.onixId);
  return {
    id: item.id.toString(),
    author: {
      id: item.author.id.toString(),
      onixId,
      username: publicDisplayName(item.author.displayName, onixId),
      ...(item.author.avatarUrl ? { avatarUrl: item.author.avatarUrl } : {}),
      ...(badge ? { badge } : {}),
    },
    rating: item.rating,
    text: item.text ?? '',
    createdAt: item.createdAt.toISOString(),
  };
}
