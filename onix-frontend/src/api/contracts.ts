export type AsyncState = 'idle' | 'loading' | 'success' | 'error';
export type ProductStatus = 'ACTIVE' | 'RESERVED' | 'SOLD_OUT' | 'ARCHIVED';
export type DealStatus = 'PENDING' | 'PAYMENT_HOLD' | 'DELIVERING' | 'COMPLETED' | 'CANCELED' | 'DISPUTE' | 'REFUNDED';

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
}

export interface Product {
  id: string;
  title: string;
  description?: string;
  priceCents: string;
  quantity: number;
  category: string;
  subcategory?: string;
  status: ProductStatus;
  seller: Seller;
  favorite?: boolean;
  createdAt: string;
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
}

export interface ChatThread {
  id: string;
  title: string;
  subtitle?: string;
  unreadCount: number;
  dealId?: string;
}

export interface Message {
  id: string;
  threadId: string;
  sender: Pick<Seller, 'id' | 'username'>;
  text: string;
  createdAt: string;
  mine: boolean;
  pending?: boolean;
}

export interface WalletOperation {
  id: string;
  type: 'DEPOSIT' | 'PURCHASE_HOLD' | 'REFUND' | 'SALE_PAYOUT' | 'ADMIN_ADJUSTMENT' | 'WITHDRAWAL';
  amountCents: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
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
  balanceCents: string;
  isAdmin: boolean;
  roles: Array<'USER' | 'ADMIN'>;
  walletHistory: WalletOperation[];
}

export interface Review {
  id: string;
  author: Pick<Seller, 'id' | 'username'>;
  rating: number;
  text: string;
  createdAt: string;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: { code: string; message: string | string[] };
}

export interface ProductDraft {
  title: string;
  description: string;
  priceRubles: string;
  quantity: number;
  category: string;
  subcategory: string;
}

export const API_PATHS = {
  me: '/api/users/me',
  ledger: '/api/wallet/ledger',
  products: '/api/products',
  productCreate: '/api/products',
  productUpdate: (id: string) => `/api/products/${encodeURIComponent(id)}`,
  productDelete: (id: string) => `/api/products/${encodeURIComponent(id)}`,
  productPurchase: (id: string) => `/api/orders/product/${encodeURIComponent(id)}`,
  favorite: (id: string) => `/api/favorites/${encodeURIComponent(id)}`,
  follow: (onixId: string) => `/api/users/${encodeURIComponent(onixId)}/follow`,
  orders: '/api/orders',
  dealDeliver: (id: string) => `/api/orders/${encodeURIComponent(id)}/deliver`,
  dealComplete: (id: string) => `/api/orders/${encodeURIComponent(id)}/complete`,
  dealDispute: (id: string) => `/api/orders/${encodeURIComponent(id)}/dispute`,
  chats: '/api/chats',
  directChat: '/api/chats/direct',
  messages: (threadId: string) => `/api/chats/${encodeURIComponent(threadId)}/messages`,
  reviews: (onixId: string) => `/api/users/${encodeURIComponent(onixId)}/reviews`,
  reviewCreate: (orderId: string) => `/api/orders/${encodeURIComponent(orderId)}/reviews`,
  walletWithdraw: '/api/wallet/withdrawals',
  notifications: '/api/notifications',
  notificationRead: (id: string) => `/api/notifications/${encodeURIComponent(id)}/read`,
  adminBan: (onixId: string) => `/api/admin/users/${encodeURIComponent(onixId)}/ban`,
} as const;

export const CATEGORIES = ['STANDOFF_2', 'STEAM', 'ROBLOX', 'RP_PROJECTS', 'BRAWL_STARS', 'OTHER'] as const;
export const CATEGORY_LABELS: Record<(typeof CATEGORIES)[number], string> = {
  STANDOFF_2: 'Standoff 2', STEAM: 'Steam', ROBLOX: 'Roblox',
  RP_PROJECTS: 'RP проекты', BRAWL_STARS: 'Brawl Stars', OTHER: 'Другое',
};
