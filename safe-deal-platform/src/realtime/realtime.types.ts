/**
 * Realtime event contracts — HTTP remains source of truth; WS only fans out.
 * Single-node in-memory bus (Render WEB_CONCURRENCY=1).
 */

export type RealtimeClientMessage =
  | { type: 'auth'; accessToken: string }
  | { type: 'ping' }
  | { type: 'subscribe_chat'; chatId: string }
  | { type: 'unsubscribe_chat'; chatId: string }
  | { type: 'typing'; chatId: string }
  | { type: 'chat.read'; chatId: string };

export type RealtimeServerMessage =
  | { type: 'ready'; userId: string }
  | { type: 'pong'; ts: number }
  | { type: 'error'; code: string; message: string }
  | {
      type: 'chat.message';
      chatId: string;
      message: Record<string, unknown>;
      /** Recipient-facing unread bump for this chat (peers only). */
      unreadDelta?: number;
    }
  | {
      type: 'chat.typing';
      chatId: string;
      userId: string;
      onixId: string;
      username: string;
    }
  | {
      type: 'chat.read';
      chatId: string;
      userId: string;
      onixId: string;
      username: string;
      lastReadAt: string;
    }
  | {
      type: 'presence';
      userId: string;
      onixId: string;
      online: boolean;
      lastOnline: string;
    }
  | {
      type: 'notification';
      id: string;
      title: string;
      body: string;
      createdAt: string;
      data?: Record<string, unknown>;
    }
  | {
      type: 'order.updated';
      orderId: string;
      status: string;
      chatId?: string;
      sound?: 'order';
    }
  | {
      type: 'product.changed';
      productId: string;
      status: string;
      quantity: number;
      /** New listing — clients may soft-reload catalog. */
      created?: boolean;
    };

/** Internal bus events (domain → hub). */
export type RealtimeBusEvent =
  | {
      kind: 'chat.message';
      chatId: string;
      /** Deliver personalized DTOs per viewer. */
      recipientUserIds: bigint[];
      /** messageDto keyed by viewer userId string */
      messageByViewer: Map<string, Record<string, unknown>>;
      /** sender does not get unreadDelta */
      senderId: bigint;
    }
  | {
      kind: 'chat.typing';
      chatId: string;
      recipientUserIds: bigint[];
      userId: bigint;
      onixId: string;
      username: string;
    }
  | {
      kind: 'presence';
      userId: bigint;
      onixId: string;
      online: boolean;
      lastOnline: string;
      /** Hint list (chat peers). Hub still broadcasts presence to all sockets. */
      watchers: bigint[];
    }
  | {
      kind: 'notification';
      userId: bigint;
      id: string;
      title: string;
      body: string;
      createdAt: string;
      data?: Record<string, unknown>;
    }
  | {
      kind: 'chat.read';
      chatId: string;
      userId: bigint;
      onixId: string;
      username: string;
      lastReadAt: string;
      recipientUserIds: bigint[];
    }
  | {
      kind: 'order.updated';
      orderId: string;
      status: string;
      chatId?: string;
      recipientUserIds: bigint[];
      soundUserIds?: bigint[];
    }
  | {
      kind: 'product.changed';
      productId: string;
      status: string;
      quantity: number;
      created?: boolean;
    };
