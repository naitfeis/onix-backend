import { Prisma } from '@prisma/client';
import { AuthUser } from './common';
import { formatOnixId } from './onix-id';

type PublicUser = {
  id: bigint;
  onixId: string;
  telegramNick: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  ratingAverage: Prisma.Decimal;
  ratingCount: number;
  completedSales: number;
  lastSeenAt: Date;
  isAdmin?: boolean;
  isSupport?: boolean;
  _count?: { followers: number };
};

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
  roles: Array<'USER' | 'ADMIN' | 'SUPPORT'>;
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
}

export function sellerDto(user: PublicUser & { followers?: Array<{ followerId: bigint }> }) {
  const staff = Boolean(user.isAdmin || user.isSupport);
  const onixId = formatOnixId(user.onixId);
  return {
    id: user.id.toString(),
    onixId,
    username: user.telegramNick ?? user.displayName ?? onixId,
    ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
    rating: Number(user.ratingAverage),
    reviewCount: user.ratingCount,
    salesCount: user.completedSales,
    followersCount: user._count?.followers ?? 0,
    lastOnline: user.lastSeenAt.toISOString(),
    // Present when marketplace includes viewer-scoped Follow rows (take: 1).
    followed: Boolean(user.followers?.length),
    ...(staff ? { badge: (user.isAdmin ? 'ADMIN' : 'SUPPORT') as 'ADMIN' | 'SUPPORT' } : {}),
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
  const roles: ProfileDto['roles'] = ['USER'];
  if (user.isAdmin) roles.push('ADMIN');
  if (user.isSupport || user.isAdmin) roles.push('SUPPORT');
  return {
    ...sellerDto(user),
    ...(user.bio ? { bio: user.bio } : {}),
    balanceCents: user.balanceCents.toString(),
    isAdmin: user.isAdmin,
    roles,
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
  description: string | null;
  priceCents: bigint;
  quantity: number;
  category: string;
  subcategory: string | null;
  status: string;
  autoDeliver?: boolean;
  createdAt: Date;
  seller: PublicUser;
  favorites?: Array<{ userId: bigint }>;
}, viewerId?: bigint): ProductDto {
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
  sender: Pick<PublicUser, 'id' | 'onixId' | 'telegramNick' | 'displayName' | 'avatarUrl' | 'isAdmin' | 'isSupport'> | null;
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
  const staffBadge = !system && sender
    ? (sender.isAdmin ? 'ADMIN' as const : sender.isSupport ? 'SUPPORT' as const : undefined)
    : undefined;
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
      username: system ? 'ONIX' : (sender!.telegramNick ?? sender!.displayName ?? formatOnixId(sender!.onixId)),
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
  author: Pick<PublicUser, 'id' | 'onixId' | 'telegramNick' | 'displayName' | 'avatarUrl' | 'isAdmin' | 'isSupport'>;
}) {
  const staff = Boolean(item.author.isAdmin || item.author.isSupport);
  const onixId = formatOnixId(item.author.onixId);
  return {
    id: item.id.toString(),
    author: {
      id: item.author.id.toString(),
      onixId,
      username: item.author.telegramNick ?? item.author.displayName ?? onixId,
      ...(item.author.avatarUrl ? { avatarUrl: item.author.avatarUrl } : {}),
      ...(staff ? { badge: (item.author.isAdmin ? 'ADMIN' : 'SUPPORT') as 'ADMIN' | 'SUPPORT' } : {}),
    },
    rating: item.rating,
    text: item.text ?? '',
    createdAt: item.createdAt.toISOString(),
  };
}
