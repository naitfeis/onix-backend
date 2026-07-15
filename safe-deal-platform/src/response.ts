import { Prisma } from '@prisma/client';
import { AuthUser } from './common';

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
}

export interface LedgerDto {
  id: string;
  type: 'DEPOSIT' | 'PURCHASE_HOLD' | 'REFUND' | 'SALE_PAYOUT' | 'ADMIN_ADJUSTMENT' | 'WITHDRAWAL';
  amountCents: string;
  /** API contract: LedgerEntry has no DB status; posted entries are always COMPLETED. */
  status: 'COMPLETED';
  createdAt: string;
}

export interface ProductDto {
  id: string;
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
  return {
    id: user.id.toString(),
    onixId: user.onixId,
    username: user.telegramNick ?? user.displayName ?? user.onixId,
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
}, viewer: AuthUser) {
  const buyer = order.buyerId === viewer.id;
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
  };
}

export function messageDto(message: {
  id: bigint;
  chatId: string;
  senderId: bigint | null;
  kind?: string;
  text: string;
  createdAt: Date;
  sender: Pick<PublicUser, 'id' | 'onixId' | 'telegramNick' | 'displayName' | 'avatarUrl' | 'isAdmin' | 'isSupport'> | null;
}, viewerId: bigint) {
  const system = message.kind === 'SYSTEM' || message.senderId == null;
  const sender = message.sender;
  const staffBadge = !system && sender
    ? (sender.isAdmin ? 'ADMIN' as const : sender.isSupport ? 'SUPPORT' as const : undefined)
    : undefined;
  return {
    id: message.id.toString(),
    threadId: message.chatId,
    kind: system ? 'SYSTEM' as const : 'USER' as const,
    sender: {
      id: system ? '0' : sender!.id.toString(),
      username: system ? 'ONIX' : (sender!.telegramNick ?? sender!.displayName ?? sender!.onixId),
      ...(system ? {} : (sender!.avatarUrl ? { avatarUrl: sender!.avatarUrl } : {})),
      ...(staffBadge ? { badge: staffBadge } : {}),
    },
    text: message.text,
    createdAt: message.createdAt.toISOString(),
    mine: !system && message.senderId === viewerId,
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
  return {
    id: item.id.toString(),
    author: {
      id: item.author.id.toString(),
      onixId: item.author.onixId,
      username: item.author.telegramNick ?? item.author.displayName ?? item.author.onixId,
      ...(item.author.avatarUrl ? { avatarUrl: item.author.avatarUrl } : {}),
      ...(staff ? { badge: (item.author.isAdmin ? 'ADMIN' : 'SUPPORT') as 'ADMIN' | 'SUPPORT' } : {}),
    },
    rating: item.rating,
    text: item.text ?? '',
    createdAt: item.createdAt.toISOString(),
  };
}
