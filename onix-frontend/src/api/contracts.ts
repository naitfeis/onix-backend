export type AsyncState = 'idle' | 'loading' | 'success' | 'error';
export type ProductStatus = 'ACTIVE' | 'RESERVED' | 'SOLD_OUT' | 'ARCHIVED';
export type DealStatus = 'PENDING' | 'PAYMENT_HOLD' | 'DELIVERING' | 'COMPLETED' | 'CANCELED' | 'DISPUTE' | 'REFUNDED';

/** Public platform status — everyone defaults to USER. */
export type PlatformStatus =
  | 'USER'
  | 'VERIFIED_SELLER'
  | 'MODERATOR'
  | 'ADMIN'
  | 'VIP';

export interface Seller {
  id: string;
  onixId: string;
  username: string;
  avatarUrl?: string;
  rating: number;
  reviewCount: number;
  salesCount: number;
  followersCount: number;
  lastOnline?: string;
  followed?: boolean;
  /** Always present from API (default USER). */
  status?: PlatformStatus;
  /** Non-USER status badge for UI chips. */
  badge?: PlatformStatus;
}

export interface Product {
  id: string;
  /** Public short code for ONIXLOT-{n}. */
  lotNumber?: number;
  title: string;
  description?: string;
  priceCents: string;
  quantity: number;
  category: string;
  subcategory?: string;
  status: ProductStatus;
  autoDeliver?: boolean;
  seller: Seller;
  favorite?: boolean;
  createdAt: string;
  /** Unique views — present only for the listing owner. */
  viewCount?: number;
}

export interface DisputeCard {
  orderId: string;
  status: 'REVIEWING' | 'RESOLVED';
  statusLabel: string;
  supportLabel: string;
  queuePosition: number | null;
  queueTotal: number;
  avgWaitMinutes: number | null;
}

export interface Deal {
  id: string;
  product: Pick<Product, 'id' | 'title' | 'category'>;
  totalAmountCents: string;
  status: DealStatus;
  role: 'buyer' | 'seller';
  counterparty: Seller;
  createdAt: string;
  canReview?: boolean;
  /** True when support/dispute already used for this order. */
  complaintOpen?: boolean;
  /** Shared buyer↔seller pair chat (same id for all deals + direct). */
  chatId?: string;
  /** Buyer/seller dispute card in Orders after support/dispute. */
  dispute?: DisputeCard;
}

export interface OrderCard {
  id: string;
  productTitle: string;
  totalAmountCents: string;
  status: DealStatus;
  escrow: boolean;
}

export interface ChatThread {
  id: string;
  title: string;
  subtitle?: string;
  kind?: 'DIRECT' | 'GROUP' | 'AI';
  unreadCount: number;
  dealId?: string;
  peerOnixId?: string;
  peerLastOnline?: string;
  peerAvatarUrl?: string;
  peerBadge?: PlatformStatus;
  orderCard?: OrderCard;
}

export interface Message {
  id: string;
  threadId: string;
  kind?: 'USER' | 'SYSTEM';
  sender: Pick<Seller, 'id' | 'username' | 'avatarUrl' | 'badge'>;
  text: string;
  createdAt: string;
  mine: boolean;
  pending?: boolean;
  deliveryStatus?: 'SENT' | 'READ';
  deleted?: boolean;
  deletedAt?: string;
  deletedReason?: string | null;
  originalText?: string;
  readBy?: Array<{ onixId: string; username: string; readAt: string }>;
}

export interface ChatUserHit {
  onixId: string;
  username: string;
  avatarUrl?: string;
  badge?: PlatformStatus;
}

export interface WalletOperation {
  id: string;
  type: 'DEPOSIT' | 'PURCHASE_HOLD' | 'REFUND' | 'SALE_PAYOUT' | 'ADMIN_ADJUSTMENT' | 'WITHDRAWAL' | 'DEPOSIT_FUND' | 'DEPOSIT_RETURN';
  amountCents: string;
  /** API contract: matches ledgerDto — no DB status column. */
  status: 'COMPLETED';
  createdAt: string;
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface Profile extends Seller {
  bio?: string;
  balanceCents: string;
  isAdmin: boolean;
  status: PlatformStatus;
  roles: PlatformStatus[];
  walletHistory: WalletOperation[];
  /** Embedded by GET /users/me after Stage 1 — prefer over extra RTT. */
  deposit?: DepositWallet;
  trustCard?: TrustCard;
}

/** GET /api/users/me/analytics — Mon–Sun week */
export interface SellerAnalyticsDay {
  day: string;
  weekday?: string;
  uniqueViews: number;
  ordersCount: number;
  completedCount: number;
  revenueCents: string;
  profitCents: string;
  favoritesAdded: number;
}

export interface SellerAnalytics {
  mode?: 'week';
  days: number;
  weekOffset?: number;
  from: string;
  to: string;
  label?: string;
  canGoNext?: boolean;
  canGoPrev?: boolean;
  totals: {
    uniqueViews: number;
    ordersCount: number;
    completedCount: number;
    revenueCents: string;
    profitCents: string;
    favoritesAdded: number;
  };
  series: SellerAnalyticsDay[];
}

/** Owner deposit wallet snapshot — also embedded on GET /api/users/me */
export interface DepositWallet {
  availableCents: string;
  lockedCents: string;
  totalCents: string;
}

/** Public trust card — GET /api/users/:onixId/trust-card (never includes trustScore) */
export interface TrustCard {
  trustLevel: number;
  level: number;
  depositTotalCents: string;
  depositTotal: string;
  registeredAt: string;
  reviewCount: number;
  salesCount: number;
  rating: number;
  phoneVerified: boolean;
  passportVerified: boolean;
  voiceVerified: boolean;
  verifications: {
    phone: boolean;
    phoneStages: { sms: boolean; call: boolean; voice: boolean };
    passport: boolean;
    voiceIdentity: boolean;
  };
  proActive: boolean;
}

export interface PublicProfile extends Seller {
  bio?: string | null;
  createdAt?: string;
  /** Present only for ADMIN viewers. */
  sellBanned?: boolean;
  products?: Array<{
    id: string;
    title: string;
    description?: string;
    priceCents: string;
    category: string;
    subcategory?: string;
    status: string;
    quantity: number;
    createdAt: string;
  }>;
  reviews?: Review[];
}

export interface ChatMemberItem {
  onixId: string;
  username: string;
  avatarUrl?: string;
  badge?: PlatformStatus;
  lastOnline?: string;
}

export interface Review {
  id: string;
  author: Pick<Seller, 'id' | 'username' | 'onixId' | 'avatarUrl' | 'badge'>;
  rating: number;
  text: string;
  createdAt: string;
}

export interface BanInfo {
  reason: string;
  reasonCode?: string | null;
  comment: string;
  bannedAt: string;
  bannedUntil: string | null;
  permanent: boolean;
  remainingMs: number | null;
  label: string;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: {
    code: string;
    message: string | string[];
    details?: unknown;
    field?: string;
    error?: string;
  };
}

export interface ProductDraft {
  title: string;
  description: string;
  priceRubles: string;
  quantity: number;
  category: string;
  subcategory: string;
  autoDeliver?: boolean;
  deliveryText?: string;
}

export type ProductListSort = 'newest' | 'price_asc' | 'price_desc' | 'rating';

export type ProductListQuery = {
  search?: string;
  category?: string;
  subcategory?: string;
  minPriceCents?: string;
  maxPriceCents?: string;
  sort?: ProductListSort;
  limit?: number;
  offset?: number;
};

export type OrderListSort = 'newest' | 'oldest' | 'expensive' | 'cheap';
export type OrderListStatus = 'open' | 'active' | 'completed' | 'canceled' | 'dispute' | 'archive';

export type OrderListQuery = {
  sort?: OrderListSort;
  status?: OrderListStatus;
};

export function productsListPath(query: ProductListQuery = {}): string {
  const params = new URLSearchParams();
  const search = query.search?.trim();
  if (search) params.set('search', search.slice(0, 100));
  if (query.category) params.set('category', query.category);
  if (query.subcategory) params.set('subcategory', query.subcategory);
  if (query.minPriceCents) params.set('minPriceCents', query.minPriceCents);
  if (query.maxPriceCents) params.set('maxPriceCents', query.maxPriceCents);
  if (query.sort) params.set('sort', query.sort);
  if (query.limit != null) params.set('limit', String(query.limit));
  if (query.offset != null) params.set('offset', String(query.offset));
  const qs = params.toString();
  return qs ? `/api/products?${qs}` : '/api/products';
}

export function ordersListPath(query: OrderListQuery = {}): string {
  const params = new URLSearchParams();
  if (query.sort) params.set('sort', query.sort);
  if (query.status) params.set('status', query.status);
  const qs = params.toString();
  return qs ? `/api/orders?${qs}` : '/api/orders';
}

export const API_PATHS = {
  me: '/api/users/me',
  ledger: '/api/wallet/ledger',
  products: '/api/products',
  productsList: productsListPath,
  productsMine: '/api/products/mine',
  productCreate: '/api/products',
  productUpdate: (id: string) => `/api/products/${encodeURIComponent(id)}`,
  productDelete: (id: string) => `/api/products/${encodeURIComponent(id)}`,
  productPurchase: (id: string) => `/api/orders/product/${encodeURIComponent(id)}`,
  favorite: (id: string) => `/api/favorites/${encodeURIComponent(id)}`,
  favorites: '/api/favorites',
  userReport: (onixId: string) => `/api/users/${encodeURIComponent(onixId)}/report`,
  follow: (onixId: string) => `/api/users/${encodeURIComponent(onixId)}/follow`,
  orders: '/api/orders',
  ordersList: ordersListPath,
  dealDeliver: (id: string) => `/api/orders/${encodeURIComponent(id)}/deliver`,
  dealComplete: (id: string) => `/api/orders/${encodeURIComponent(id)}/complete`,
  dealDispute: (id: string) => `/api/orders/${encodeURIComponent(id)}/dispute`,
  orderRefundRequest: (id: string) => `/api/orders/${encodeURIComponent(id)}/refund-request`,
  orderSupport: (id: string) => `/api/orders/${encodeURIComponent(id)}/support`,
  supportRefund: (id: string) => `/api/support/orders/${encodeURIComponent(id)}/refund`,
  supportComplete: (id: string) => `/api/support/orders/${encodeURIComponent(id)}/complete`,
  supportClose: (id: string) => `/api/support/tickets/${encodeURIComponent(id)}/close`,
  supportQueue: '/api/support/queue',
  supportReports: '/api/support/reports',
  supportReportReply: (id: string) => `/api/support/reports/${encodeURIComponent(id)}/reply`,
  supportReportClose: (id: string) => `/api/support/reports/${encodeURIComponent(id)}/close`,
  mePresence: '/api/users/me/presence',
  leaveGroupChat: (threadId: string) => `/api/chats/${encodeURIComponent(threadId)}/members/me`,
  adminProductRemove: (id: string) => `/api/admin/products/${encodeURIComponent(id)}`,
  adminSellBan: (onixId: string) => `/api/admin/users/${encodeURIComponent(onixId)}/sell-ban`,
  chats: '/api/chats',
  chatsSearch: (q: string) => `/api/chats?q=${encodeURIComponent(q)}`,
  chatUserSearch: (q: string) => `/api/chats/users/search?q=${encodeURIComponent(q)}`,
  directChat: '/api/chats/direct',
  createGroupChat: '/api/chats/groups',
  addChatMembers: (threadId: string) => `/api/chats/${encodeURIComponent(threadId)}/members`,
  chatMembers: (threadId: string) => `/api/chats/${encodeURIComponent(threadId)}/members`,
  messages: (threadId: string) => `/api/chats/${encodeURIComponent(threadId)}/messages`,
  messageDelete: (threadId: string, messageId: string, scope?: 'self' | 'global') =>
    `/api/chats/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}${scope === 'global' ? '?scope=global' : ''}`,
  userPublic: (onixId: string) => `/api/users/${encodeURIComponent(onixId)}`,
  reviews: (onixId: string) => `/api/users/${encodeURIComponent(onixId)}/reviews`,
  reviewCreate: (orderId: string) => `/api/orders/${encodeURIComponent(orderId)}/reviews`,
  walletWithdraw: '/api/wallet/withdrawals',
  walletDeposit: '/api/wallet/deposit',
  walletDepositLedger: '/api/wallet/deposit/ledger',
  walletDepositLocks: '/api/wallet/deposit/locks',
  walletDepositFund: '/api/wallet/deposit/fund',
  walletDepositTopup: '/api/wallet/deposit/topup',
  walletDepositWithdraw: '/api/wallet/deposit/withdrawals',
  paymentsIntents: '/api/payments/intents',
  paymentIntentConfirm: (id: string) => `/api/payments/intents/${encodeURIComponent(id)}/confirm`,
  meTrust: '/api/users/me/trust',
  meTrustHistory: '/api/users/me/trust/history',
  meAnalytics: (weekOffset?: number) => (
    weekOffset != null && weekOffset !== 0
      ? `/api/users/me/analytics?weekOffset=${encodeURIComponent(String(weekOffset))}`
      : '/api/users/me/analytics'
  ),
  userTrustCard: (onixId: string) => `/api/users/${encodeURIComponent(onixId)}/trust-card`,
  meVerifications: '/api/users/me/verifications',
  mePro: '/api/users/me/pro',
  productView: (id: string) => `/api/products/${encodeURIComponent(id)}/views`,
  notifications: '/api/notifications',
  notificationRead: (id: string) => `/api/notifications/${encodeURIComponent(id)}/read`,
  subcategories: '/api/products/catalog/subcategories',
  adminBan: (onixId: string) => `/api/admin/users/${encodeURIComponent(onixId)}/ban`,
  adminStatus: (onixId: string) => `/api/admin/users/${encodeURIComponent(onixId)}/status`,
  productByLot: (lotNumber: string | number) => `/api/products/lot/${encodeURIComponent(String(lotNumber))}`,
  aiChat: '/api/ai/chat',
} as const;

export const PLATFORM_STATUS_OPTIONS: Array<{ value: PlatformStatus; label: string }> = [
  { value: 'USER', label: 'Пользователь' },
  { value: 'VERIFIED_SELLER', label: 'Проверенный продавец' },
  { value: 'MODERATOR', label: 'Модератор' },
  { value: 'ADMIN', label: 'Админ' },
  { value: 'VIP', label: 'VIP' },
];

export type BanReasonCode =
  | 'MISCONDUCT'
  | 'THIRD_PARTY_ADS'
  | 'OFF_PLATFORM_DEAL'
  | 'FRAUD'
  | 'OTHER';

export const BAN_REASON_OPTIONS: Array<{ value: BanReasonCode; label: string; hint: string }> = [
  { value: 'MISCONDUCT', label: 'Неадекватное поведение', hint: '7 дней' },
  { value: 'THIRD_PARTY_ADS', label: 'Реклама сторонней площадки', hint: '30 дней' },
  { value: 'OFF_PLATFORM_DEAL', label: 'Попытка сделки вне ONIX', hint: 'Навсегда' },
  { value: 'FRAUD', label: 'Мошенничество', hint: 'Навсегда' },
  { value: 'OTHER', label: 'Другое', hint: 'Срок вручную' },
];

export const CATEGORIES = ['STANDOFF_2', 'STEAM', 'ROBLOX', 'RP_PROJECTS', 'BRAWL_STARS', 'OTHER'] as const;
export const CATEGORY_LABELS: Record<(typeof CATEGORIES)[number], string> = {
  STANDOFF_2: 'Standoff 2', STEAM: 'Steam', ROBLOX: 'Roblox',
  RP_PROJECTS: 'RP проекты', BRAWL_STARS: 'Brawl Stars', OTHER: 'Другое',
};

/** Prisma ProductSubcategory labels (not free-text). */
export const SUBCATEGORIES_BY_CATEGORY: Record<(typeof CATEGORIES)[number], string[]> = {
  STANDOFF_2: ['STANDOFF_GOLD', 'STANDOFF_ACCOUNTS', 'STANDOFF_SKINS', 'STANDOFF_OTHER'],
  STEAM: ['STEAM_TOPUP', 'STEAM_ACCOUNTS', 'STEAM_KEYS', 'STEAM_SKINS', 'STEAM_OTHER'],
  ROBLOX: ['ROBLOX_ROBUX', 'ROBLOX_ACCOUNTS', 'ROBLOX_ITEMS', 'ROBLOX_OTHER'],
  RP_PROJECTS: ['RP_VIRTS', 'RP_ACCOUNTS', 'RP_ITEMS', 'RP_OTHER'],
  BRAWL_STARS: ['BRAWL_DONATE', 'BRAWL_ACCOUNTS', 'BRAWL_BOOST', 'BRAWL_OTHER'],
  OTHER: ['OTHER_ACCOUNTS', 'OTHER_ITEMS', 'OTHER_BOOST', 'OTHER_MISC'],
};

export const SUBCATEGORY_LABELS: Record<string, string> = {
  STANDOFF_GOLD: 'Gold', STANDOFF_ACCOUNTS: 'Аккаунты', STANDOFF_SKINS: 'Скины', STANDOFF_OTHER: 'Другое',
  STEAM_TOPUP: 'Пополнение', STEAM_ACCOUNTS: 'Аккаунты', STEAM_KEYS: 'Ключи', STEAM_SKINS: 'Скины', STEAM_OTHER: 'Другое',
  ROBLOX_ROBUX: 'Робуксы', ROBLOX_ACCOUNTS: 'Аккаунты', ROBLOX_ITEMS: 'Предметы', ROBLOX_OTHER: 'Другое',
  RP_VIRTS: 'Вирты', RP_ACCOUNTS: 'Аккаунты', RP_ITEMS: 'Предметы', RP_OTHER: 'Другое',
  BRAWL_DONATE: 'Донат', BRAWL_ACCOUNTS: 'Аккаунты', BRAWL_BOOST: 'Буст', BRAWL_OTHER: 'Другое',
  OTHER_ACCOUNTS: 'Аккаунты', OTHER_ITEMS: 'Предметы', OTHER_BOOST: 'Буст', OTHER_MISC: 'Прочее',
};

/** Heartbeat ~45s → keep window ≥ 3 min so brief idle still shows online. */
const ONLINE_WINDOW_MS = 3 * 60_000;

/** True when lastOnline is within the online window (~3 min). */
export function isOnline(iso?: string | null): boolean {
  if (!iso) return false;
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return false;
  return Date.now() - at < ONLINE_WINDOW_MS;
}

/**
 * Presence for avatars: if this seller is the signed-in user browsing the app → online.
 * Otherwise use lastOnline freshness (kept alive by /users/me/presence heartbeat).
 */
export function sellerIsPresent(
  seller: Pick<Seller, 'onixId' | 'lastOnline'>,
  me?: Pick<Seller, 'onixId' | 'lastOnline'> | null,
): boolean {
  const norm = (v: string) => v.trim().toUpperCase().replace(/^ONIX-0+/, 'ONIX-');
  if (me && norm(seller.onixId) === norm(me.onixId)) return true;
  return isOnline(seller.lastOnline);
}

export interface SupportQueueItem {
  orderId: string;
  status: string;
  productTitle: string;
  totalAmountCents: string;
  chatId: string | null;
  ticketId: string | null;
  reason: string | null;
  buyer: { onixId: string; username: string };
  seller: { onixId: string; username: string };
  createdAt: string;
  kind: 'SUPPORT' | 'DISPUTE';
}

export interface UserReportItem {
  id: string;
  /** USER = person complaint; AI_SUPPORT = from ONIX AI support widget. */
  kind?: 'USER' | 'AI_SUPPORT';
  reason: string;
  comment: string;
  adminReply?: string;
  repliedAt?: string;
  createdAt: string;
  reporter: { onixId: string; username: string; avatarUrl?: string };
  target: { onixId: string; username: string; avatarUrl?: string };
}

/** lastSeen display — precise online arrives with WebSocket (5.6). */
export function formatLastSeen(iso?: string | null): string {
  if (!iso) return 'был(а) недавно';
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return 'был(а) недавно';
  const diffMs = Date.now() - at;
  if (diffMs < ONLINE_WINDOW_MS) return 'Online';
  if (diffMs < 60 * 60_000) return `Был ${Math.max(1, Math.round(diffMs / 60_000))} минут назад`;
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  if (at >= dayStart.getTime() - 86400_000 && at < dayStart.getTime()) return 'Был вчера';
  return `Был ${new Date(iso).toLocaleDateString('ru-RU')}`;
}

export function formatBanRemaining(ban: BanInfo): string {
  if (ban.permanent) return 'Постоянная блокировка.';
  const ms = ban.remainingMs ?? (ban.bannedUntil ? Math.max(0, new Date(ban.bannedUntil).getTime() - Date.now()) : 0);
  if (ms <= 0) return 'Срок блокировки истёк.';
  const days = Math.floor(ms / 86400_000);
  const hours = Math.floor((ms % 86400_000) / 3600_000);
  if (days > 0) return `Осталось: ${days} д. ${hours} ч.`;
  const mins = Math.max(1, Math.floor((ms % 3600_000) / 60_000));
  if (hours > 0) return `Осталось: ${hours} ч. ${mins} мин.`;
  return `Осталось: ${mins} мин.`;
}

/** Recompute remaining from bannedUntil (for live ban screen). */
export function refreshBanInfo(ban: BanInfo): BanInfo {
  if (ban.permanent || !ban.bannedUntil) return { ...ban, remainingMs: null, label: 'Постоянная блокировка.' };
  const remainingMs = Math.max(0, new Date(ban.bannedUntil).getTime() - Date.now());
  return {
    ...ban,
    remainingMs,
    label: remainingMs <= 0
      ? 'Срок блокировки истёк.'
      : `До ${new Date(ban.bannedUntil).toLocaleString('ru-RU')}`,
  };
}
