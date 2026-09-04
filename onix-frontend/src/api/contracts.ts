export type AsyncState = 'idle' | 'loading' | 'success' | 'error';
export type ProductStatus = 'ACTIVE' | 'RESERVED' | 'SOLD_OUT' | 'ARCHIVED';
export type DealStatus = 'PENDING' | 'PAYMENT_HOLD' | 'DELIVERING' | 'COMPLETED' | 'CANCELED' | 'DISPUTE' | 'REFUNDED';

/** Public platform status — everyone defaults to USER. */
export type PlatformStatus =
  | 'USER'
  | 'VERIFIED_SELLER'
  | 'MODERATOR'
  | 'ADMIN'
  | 'SUPER_ADMIN'
  | 'VIP';

/** Staff roles for support surfaces — mirrors BE isStaffPlatformStatus. */
export function isStaffPlatformStatus(status?: PlatformStatus | null): boolean {
  return status === 'MODERATOR' || status === 'ADMIN' || status === 'SUPER_ADMIN';
}

/** BE catalog map: category → subcategory enum codes. */
export type SubcategoryCatalog = Record<string, string[]>;

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
  warrantyHours?: number;
  warrantyLabel?: string;
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
  product: Pick<Product, 'id' | 'title' | 'category'> & {
    subcategory?: string;
    autoDeliver?: boolean;
    warrantyHours?: number;
  };
  totalAmountCents: string;
  status: DealStatus;
  warrantyHours?: number;
  warrantyEndsAt?: string | null;
  refundKind?: 'SELLER' | 'ADMIN' | null;
  payoutKind?: 'BUYER' | 'ADMIN' | null;
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
  peerUserId?: string;
  peerBadge?: PlatformStatus;
  orderCard?: OrderCard;
}

export interface Message {
  id: string;
  threadId: string;
  kind?: 'USER' | 'SYSTEM';
  contentType?: 'TEXT' | 'IMAGE' | 'FILE';
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
  attachment?: {
    id: string;
    mimeType: string;
    originalName: string;
    sizeBytes: number;
  };
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
  type?: string;
  chatId?: string;
  orderId?: string;
}

export interface Profile extends Seller {
  bio?: string;
  balanceCents: string;
  isAdmin: boolean;
  isSupport?: boolean;
  status: PlatformStatus;
  roles: PlatformStatus[];
  walletHistory: WalletOperation[];
  /** Account registration time from GET /users/me. */
  registeredAt?: string;
  /** Embedded by GET /users/me after Stage 1 — prefer over extra RTT. */
  deposit?: DepositWallet;
  trustCard?: TrustCard;
  canSell?: boolean;
  hasTelegram?: boolean;
  hasGoogle?: boolean;
  securityLock?: {
    locked: boolean;
    level?: string | null;
    reason?: string | null;
    caseId?: string | null;
    withdrawBlocked?: boolean;
    fundsHold?: boolean;
  };
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
    warrantyHours?: number;
    lotNumber?: number;
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
  warrantyHours?: number;
  acceptedRules?: boolean;
}

export type ProductListSort = 'newest' | 'price_asc' | 'price_desc' | 'rating' | 'warranty' | 'reliability';

export type ProductListQuery = {
  search?: string;
  category?: string;
  subcategory?: string;
  minPriceCents?: string;
  maxPriceCents?: string;
  sort?: ProductListSort;
  autoDeliver?: boolean;
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
  if (query.autoDeliver) params.set('autoDeliver', 'true');
  if (query.limit != null) params.set('limit', String(query.limit));
  if (query.offset != null) params.set('offset', String(query.offset));
  const qs = params.toString();
  return qs ? `/api/products?${qs}` : '/api/products';
}

export function productsMinePath(query: { limit?: number; offset?: number } = {}): string {
  const params = new URLSearchParams();
  if (query.limit != null) params.set('limit', String(query.limit));
  if (query.offset != null) params.set('offset', String(query.offset));
  const qs = params.toString();
  return qs ? `/api/products/mine?${qs}` : '/api/products/mine';
}

export function walletLedgerPath(query: { limit?: number; offset?: number } = {}): string {
  const params = new URLSearchParams();
  if (query.limit != null) params.set('limit', String(query.limit));
  if (query.offset != null) params.set('offset', String(query.offset));
  const qs = params.toString();
  return qs ? `/api/wallet/ledger?${qs}` : '/api/wallet/ledger';
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
  walletLedger: walletLedgerPath,
  products: '/api/products',
  productsList: productsListPath,
  productsMine: '/api/products/mine',
  productsMineList: productsMinePath,
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
  dealCancel: (id: string) => `/api/orders/${encodeURIComponent(id)}/cancel`,
  dealDispute: (id: string) => `/api/orders/${encodeURIComponent(id)}/dispute`,
  orderRefundRequest: (id: string) => `/api/orders/${encodeURIComponent(id)}/refund-request`,
  orderSupport: (id: string) => `/api/orders/${encodeURIComponent(id)}/support`,
  supportAppeal: '/api/support/appeals',
  mePresence: '/api/users/me/presence',
  leaveGroupChat: (threadId: string) => `/api/chats/${encodeURIComponent(threadId)}/members/me`,
  chats: '/api/chats',
  chatsSearch: (q: string) => `/api/chats?q=${encodeURIComponent(q)}`,
  chatUserSearch: (q: string) => `/api/chats/users/search?q=${encodeURIComponent(q)}`,
  directChat: '/api/chats/direct',
  createGroupChat: '/api/chats/groups',
  addChatMembers: (threadId: string) => `/api/chats/${encodeURIComponent(threadId)}/members`,
  chatMembers: (threadId: string) => `/api/chats/${encodeURIComponent(threadId)}/members`,
  messages: (threadId: string) => `/api/chats/${encodeURIComponent(threadId)}/messages`,
  attachmentUploadIntent: (chatId: string) => `/api/chats/${encodeURIComponent(chatId)}/attachments/upload-intent`,
  attachmentComplete: (chatId: string, id: string) => `/api/chats/${encodeURIComponent(chatId)}/attachments/${encodeURIComponent(id)}/complete`,
  attachmentDownload: (id: string) => `/api/chats/attachments/${encodeURIComponent(id)}/download`,
  messageDelete: (threadId: string, messageId: string, scope?: 'self' | 'global') =>
    `/api/chats/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}${scope === 'global' ? '?scope=global' : ''}`,
  userPublic: (onixId: string) => `/api/users/${encodeURIComponent(onixId)}`,
  reviews: (onixId: string) => `/api/users/${encodeURIComponent(onixId)}/reviews`,
  reviewCreate: (orderId: string) => `/api/orders/${encodeURIComponent(orderId)}/reviews`,
  reviewAppeal: (id: string) => `/api/reviews/${encodeURIComponent(id)}/appeal`,
  aiChat: '/api/ai/chat',
  aiFaqs: '/api/ai/faqs',
  aiMessages: '/api/ai/messages',
  authGoogle: '/api/v2/auth/google',
  authPublicConfig: '/api/v2/auth/public-config',
  authLinkTelegram: '/api/v2/auth/link/telegram',
  authLinkGoogle: '/api/v2/auth/link/google',
  walletWithdraw: '/api/wallet/withdrawals',
  mfaStatus: (challengeId: string) =>
    `/api/v2/auth/mfa/status?challengeId=${encodeURIComponent(challengeId)}`,
  walletDeposit: '/api/wallet/deposit',
  walletDepositLedger: '/api/wallet/deposit/ledger',
  walletDepositLocks: '/api/wallet/deposit/locks',
  walletDepositFund: '/api/wallet/deposit/fund',
  walletDepositTopup: '/api/wallet/deposit/topup',
  walletDepositWithdraw: '/api/wallet/deposit/withdrawals',
  paymentsIntents: '/api/payments/intents',
  paymentIntent: (id: string) => `/api/payments/intents/${encodeURIComponent(id)}`,
  paymentIntentConfirm: (id: string) => `/api/payments/intents/${encodeURIComponent(id)}/confirm`,
  supportTickets: '/api/support/tickets',
  meTrust: '/api/users/me/trust',
  meTrustHistory: '/api/users/me/trust/history',
  meAnalytics: (weekOffset?: number) => (
    weekOffset != null && weekOffset !== 0
      ? `/api/users/me/analytics?weekOffset=${encodeURIComponent(String(weekOffset))}`
      : '/api/users/me/analytics'
  ),
  userTrustCard: (onixId: string) => `/api/users/${encodeURIComponent(onixId)}/trust-card`,
  /** @status FUTURE — Pro seller plan surface not wired in UI yet. */
  mePro: '/api/users/me/pro',
  productView: (id: string) => `/api/products/${encodeURIComponent(id)}/views`,
  notifications: '/api/notifications',
  notificationRead: (id: string) => `/api/notifications/${encodeURIComponent(id)}/read`,
  subcategories: '/api/products/catalog/subcategories',
  productCategoryCounts: '/api/products/catalog/counts',
  productByLot: (lotNumber: string | number) => `/api/products/lot/${encodeURIComponent(String(lotNumber))}`,
} as const;

/**
 * FE↔API path classification for audits.
 * LIVE = UI calls it; FUTURE = planned; DEPRECATED = keep for external/compat; FALLBACK = offline seed only.
 */
export const API_PATH_STATUS = {
  dealCancel: 'LIVE',
  dealDeliver: 'LIVE',
  dealComplete: 'LIVE',
  dealDispute: 'LIVE',
  subcategories: 'LIVE',
  productCategoryCounts: 'LIVE',
  meVerifications: 'FUTURE',
  mePro: 'FUTURE',
  supportClose: 'DEPRECATED',
} as const;

export const PLATFORM_STATUS_OPTIONS: Array<{ value: PlatformStatus; label: string }> = [
  { value: 'USER', label: 'Пользователь' },
  { value: 'VERIFIED_SELLER', label: 'Проверенный продавец' },
  { value: 'MODERATOR', label: 'Модератор' },
  { value: 'ADMIN', label: 'Админ' },
  { value: 'SUPER_ADMIN', label: 'Основатель' },
  { value: 'VIP', label: 'VIP' },
];

/** Statuses a regular ADMIN may assign (not ADMIN / SUPER_ADMIN). */
export const ADMIN_ASSIGNABLE_STATUS_OPTIONS = PLATFORM_STATUS_OPTIONS.filter(
  (item) => item.value !== 'ADMIN' && item.value !== 'SUPER_ADMIN',
);

export type BanReasonCode =
  | 'MISCONDUCT'
  | 'THIRD_PARTY_ADS'
  | 'OFF_PLATFORM_DEAL'
  | 'FRAUD'
  | 'SELLER_NO_RESPONSE'
  | 'SALE_PAYOUT'
  | 'OTHER';

export const BAN_REASON_OPTIONS: Array<{ value: BanReasonCode; label: string; hint: string }> = [
  { value: 'MISCONDUCT', label: 'Неадекватное поведение', hint: '7 дней' },
  { value: 'THIRD_PARTY_ADS', label: 'Реклама сторонней площадки', hint: '30 дней' },
  { value: 'OFF_PLATFORM_DEAL', label: 'Попытка сделки вне ONIX', hint: 'Навсегда' },
  { value: 'FRAUD', label: 'Мошенничество', hint: 'Навсегда' },
  { value: 'SELLER_NO_RESPONSE', label: 'Продавец не отвечает', hint: '7 дней' },
  { value: 'SALE_PAYOUT', label: 'Выплата за продажу от 100 ₽', hint: '7 дней' },
  { value: 'OTHER', label: 'Другое', hint: 'Срок вручную' },
];

export const CATEGORIES = [
  'STEAM', 'ROBLOX', 'RP_PROJECTS',
  'CS2', 'STANDOFF_2', 'FORTNITE', 'BRAWL_STARS', 'GTA_5', 'GTA_6',
  'DOTA_2', 'PUBG_MOBILE', 'GENSHIN', 'MOBILE_LEGENDS', 'APP_STORE',
  'PUBG', 'MINECRAFT', 'PLAYSTATION', 'STALCRAFT', 'PATH_OF_EXILE_2', 'OTHER',
] as const;
export const CATEGORY_LABELS: Record<string, string> = {
  STEAM: 'Steam',
  ROBLOX: 'Roblox',
  RP_PROJECTS: 'RP проекты',
  STANDOFF_2: 'Standoff 2',
  BRAWL_STARS: 'Brawl Stars',
  CS2: 'Counter-Strike 2',
  FORTNITE: 'Fortnite',
  VALORANT: 'Valorant',
  GTA_5: 'GTA 5',
  GTA_6: 'GTA 6',
  DOTA_2: 'Dota 2',
  PUBG_MOBILE: 'PUBG Mobile',
  GENSHIN: 'Genshin Impact',
  MOBILE_LEGENDS: 'Mobile Legends',
  APP_STORE: 'App Store',
  PUBG: 'PUBG',
  MINECRAFT: 'Minecraft',
  PLAYSTATION: 'PlayStation',
  STALCRAFT: 'Stalzone',
  PATH_OF_EXILE_2: 'Path of Exile 2',
  OTHER: 'Другое',
};

/** Fallback only — prefer GET /api/products/catalog/subcategories at runtime. */
export const SUBCATEGORIES_BY_CATEGORY: Record<(typeof CATEGORIES)[number], string[]> = {
  STANDOFF_2: ['STANDOFF_GOLD', 'STANDOFF_ACCOUNTS', 'STANDOFF_SKINS', 'STANDOFF_OTHER'],
  STEAM: ['STEAM_TOPUP', 'STEAM_ACCOUNTS', 'STEAM_KEYS', 'STEAM_SKINS', 'STEAM_OTHER'],
  ROBLOX: ['ROBLOX_ROBUX', 'ROBLOX_ACCOUNTS', 'ROBLOX_ITEMS', 'ROBLOX_OTHER'],
  RP_PROJECTS: ['RP_VIRTS', 'RP_ACCOUNTS', 'RP_ITEMS', 'RP_OTHER'],
  BRAWL_STARS: ['BRAWL_DONATE', 'BRAWL_ACCOUNTS', 'BRAWL_BOOST', 'BRAWL_OTHER'],
  CS2: ['CS2_SKINS', 'CS2_ACCOUNTS', 'CS2_BOOST', 'CS2_OTHER'],
  FORTNITE: ['FORTNITE_DONATE', 'FORTNITE_ACCOUNTS', 'FORTNITE_SERVICES', 'FORTNITE_OTHER'],
  GTA_5: ['GTA5_DONATE', 'GTA5_CURRENCY', 'GTA5_ACCOUNTS', 'GTA5_SERVICES', 'GTA5_OTHER'],
  GTA_6: ['GTA6_ACCOUNTS', 'GTA6_KEYS'],
  DOTA_2: ['DOTA_ACCOUNTS', 'DOTA_ITEMS', 'DOTA_BOOST', 'DOTA_OTHER'],
  PUBG_MOBILE: ['PUBG_DONATE', 'PUBG_ACCOUNTS', 'PUBG_SERVICES', 'PUBG_OTHER'],
  GENSHIN: ['GENSHIN_DONATE', 'GENSHIN_ACCOUNTS', 'GENSHIN_SERVICES', 'GENSHIN_OTHER'],
  MOBILE_LEGENDS: ['ML_DONATE', 'ML_ACCOUNTS', 'ML_SERVICES', 'ML_OTHER'],
  APP_STORE: ['APPSTORE_TOPUP', 'APPSTORE_GIFTCARDS', 'APPSTORE_ACCOUNTS', 'APPSTORE_OTHER'],
  PUBG: ['PUBG_DONATE', 'PUBG_ACCOUNTS', 'PUBG_SERVICES', 'PUBG_OTHER'],
  MINECRAFT: ['MC_ACCOUNTS', 'MC_ITEMS', 'MC_SERVICES', 'MC_OTHER'],
  PLAYSTATION: ['PS_ACCOUNTS', 'PS_GAMES', 'PS_TOPUP', 'PS_OTHER'],
  STALCRAFT: ['STALCRAFT_ACCOUNTS', 'STALCRAFT_ITEMS', 'STALCRAFT_SERVICES', 'STALCRAFT_OTHER'],
  PATH_OF_EXILE_2: ['POE2_ACCOUNTS', 'POE2_CURRENCY', 'POE2_ITEMS', 'POE2_OTHER'],
  OTHER: ['OTHER_ACCOUNTS', 'OTHER_ITEMS', 'OTHER_BOOST', 'OTHER_MISC'],
};

export const SUBCATEGORY_LABELS: Record<string, string> = {
  STANDOFF_GOLD: 'Gold', STANDOFF_ACCOUNTS: 'Аккаунты', STANDOFF_SKINS: 'Скины', STANDOFF_OTHER: 'Другое',
  STEAM_TOPUP: 'Пополнение', STEAM_ACCOUNTS: 'Аккаунты', STEAM_KEYS: 'Ключи', STEAM_SKINS: 'Скины', STEAM_OTHER: 'Другое',
  ROBLOX_ROBUX: 'Робуксы', ROBLOX_ACCOUNTS: 'Аккаунты', ROBLOX_ITEMS: 'Предметы', ROBLOX_OTHER: 'Другое',
  RP_VIRTS: 'Вирты', RP_ACCOUNTS: 'Аккаунты', RP_ITEMS: 'Предметы', RP_OTHER: 'Другое',
  BRAWL_DONATE: 'Донат', BRAWL_ACCOUNTS: 'Аккаунты', BRAWL_BOOST: 'Буст', BRAWL_OTHER: 'Другое',
  CS2_SKINS: 'Скины', CS2_ACCOUNTS: 'Аккаунты', CS2_BOOST: 'Буст', CS2_OTHER: 'Прочее',
  FORTNITE_DONATE: 'Донат', FORTNITE_ACCOUNTS: 'Аккаунты', FORTNITE_SERVICES: 'Услуги', FORTNITE_OTHER: 'Прочее',
  VALORANT_DONATE: 'Донат', VALORANT_ACCOUNTS: 'Аккаунты', VALORANT_SERVICES: 'Услуги', VALORANT_OTHER: 'Прочее',
  GTA5_DONATE: 'Донат', GTA5_CURRENCY: 'Валюта', GTA5_ACCOUNTS: 'Аккаунты', GTA5_SERVICES: 'Услуги', GTA5_OTHER: 'Прочее',
  GTA6_ACCOUNTS: 'Аккаунты', GTA6_KEYS: 'Ключи',
  DOTA_ACCOUNTS: 'Аккаунты', DOTA_ITEMS: 'Предметы', DOTA_BOOST: 'Буст', DOTA_OTHER: 'Прочее',
  PUBG_DONATE: 'Донат', PUBG_ACCOUNTS: 'Аккаунты', PUBG_SERVICES: 'Услуги', PUBG_OTHER: 'Прочее',
  GENSHIN_DONATE: 'Донат', GENSHIN_ACCOUNTS: 'Аккаунты', GENSHIN_SERVICES: 'Услуги', GENSHIN_OTHER: 'Прочее',
  ML_DONATE: 'Донат', ML_ACCOUNTS: 'Аккаунты', ML_SERVICES: 'Услуги', ML_OTHER: 'Прочее',
  APPSTORE_TOPUP: 'Пополнение', APPSTORE_GIFTCARDS: 'Подарочные карты', APPSTORE_ACCOUNTS: 'Аккаунты', APPSTORE_OTHER: 'Прочее',
  MC_ACCOUNTS: 'Аккаунты', MC_ITEMS: 'Предметы', MC_SERVICES: 'Услуги', MC_OTHER: 'Прочее',
  PS_ACCOUNTS: 'Аккаунты', PS_GAMES: 'Игры', PS_TOPUP: 'Пополнение', PS_OTHER: 'Прочее',
  STALCRAFT_ACCOUNTS: 'Аккаунты', STALCRAFT_ITEMS: 'Предметы', STALCRAFT_SERVICES: 'Услуги', STALCRAFT_OTHER: 'Прочее',
  POE2_ACCOUNTS: 'Аккаунты', POE2_CURRENCY: 'Валюта', POE2_ITEMS: 'Предметы', POE2_OTHER: 'Прочее',
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

/** Normalize ONIX id for presence map / identity compares. */
export function normOnixId(value: string): string {
  return value.trim().toUpperCase().replace(/^ONIX-0+/, 'ONIX-');
}

/**
 * Presence for avatars: if this seller is the signed-in user browsing the app → online.
 * Prefer live WS presence when available; else lastOnline freshness.
 */
export function sellerIsPresent(
  seller: Pick<Seller, 'onixId' | 'lastOnline'>,
  me?: Pick<Seller, 'onixId' | 'lastOnline'> | null,
  live?: { online: boolean; lastOnline: string } | null,
): boolean {
  if (me && normOnixId(seller.onixId) === normOnixId(me.onixId)) return true;
  // WS presence flag is authoritative (do not re-gate on lastOnline freshness).
  if (live) return live.online;
  return isOnline(seller.lastOnline);
}

/** Human labels for wallet ledger operation types. */
export const LEDGER_TYPE_LABELS: Record<WalletOperation['type'], string> = {
  DEPOSIT: 'Пополнение',
  DEPOSIT_FUND: 'Пополнение залога',
  DEPOSIT_RETURN: 'Возврат залога',
  PURCHASE_HOLD: 'Покупки',
  REFUND: 'Возврат',
  SALE_PAYOUT: 'Выплата с продажи',
  ADMIN_ADJUSTMENT: 'Корректировка',
  WITHDRAWAL: 'Вывод',
};

export function ledgerTypeLabel(type: string): string {
  return LEDGER_TYPE_LABELS[type as WalletOperation['type']] ?? type;
}

/** Wallet history amount: credits (sale, top-up) show a leading +. */
export function formatLedgerAmount(amountCents: string): string {
  const value = Number(amountCents);
  if (!Number.isFinite(value)) return '—';
  const formatted = new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 2,
  }).format(Math.abs(value) / 100);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return formatted;
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
