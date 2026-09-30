import type { Message } from '../api/contracts';

export function messageKey(id: unknown): string {
  return String(id ?? '');
}

/**
 * Message ids are BigInt autoincrement serialized as decimal strings, so they can
 * exceed Number.MAX_SAFE_INTEGER. Compare digit-count-then-lexicographically,
 * which is exact for non-negative decimal strings.
 */
export function compareMessageId(a: string, b: string): number {
  const left = a.replace(/^0+/, '') || '0';
  const right = b.replace(/^0+/, '') || '0';
  if (left.length !== right.length) return left.length - right.length;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Idempotency key for one chat send (server enforces uniqueness per chat). */
export function newClientMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `m${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Merge one inbound message into the rendered thread.
 *
 * Dedupe is by server id, so the same frame delivered twice (reconnect replay,
 * duplicate broadcast) collapses to one bubble. A local echo is also collapsed:
 * same author + same text within 4s keeps the placeholder position and adopts the
 * server id, which is what makes a retried send still render once.
 *
 * Insertion is id-ordered, not append-only: a realtime frame can arrive before an
 * in-flight history response, and appending it would put a newer-looking message
 * below an older one.
 */
export function appendUniqueMessage(list: Message[], incoming: Message): Message[] {
  const incomingId = messageKey(incoming.id);
  if (!incomingId) return list;
  const normalized = { ...incoming, id: incomingId };
  const idx = list.findIndex((row) => messageKey(row.id) === incomingId);
  if (idx === -1) {
    // Collapse only a real local placeholder (pending) into its server copy, and
    // adopt the server id so later frames dedupe by id. Matching on text+time alone
    // used to swallow legitimate repeats — two quick «да» in a deal chat became one
    // message, which is a lost message and can matter as dispute evidence.
    const echo = list.findIndex((row) => (
      row.pending === true
      && row.mine === normalized.mine
      && row.sender.id === normalized.sender.id
      && (row.text || '') === (normalized.text || '')
    ));
    if (echo >= 0) {
      const copy = list.slice();
      copy[echo] = { ...list[echo]!, ...normalized, id: incomingId, pending: false };
      return copy;
    }
    const last = list[list.length - 1];
    if (!last || compareMessageId(incomingId, messageKey(last.id)) > 0) {
      return [...list, normalized];
    }
    let insertAt = list.length;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (compareMessageId(messageKey(list[i]!.id), incomingId) < 0) {
        insertAt = i + 1;
        break;
      }
      if (i === 0) insertAt = 0;
    }
    const copy = list.slice();
    copy.splice(insertAt, 0, normalized);
    return copy;
  }
  const prev = list[idx]!;
  const nextText = normalized.text?.trim() ? normalized.text : prev.text;
  const nextReadBy = (normalized.readBy?.length ?? 0) > (prev.readBy?.length ?? 0) ? normalized.readBy : prev.readBy;
  const nextStatus = normalized.deliveryStatus === 'READ' || prev.deliveryStatus === 'READ'
    ? 'READ' as const
    : (normalized.deliveryStatus ?? prev.deliveryStatus);
  if (nextText === prev.text && nextReadBy === prev.readBy && nextStatus === prev.deliveryStatus) return list;
  const copy = list.slice();
  copy[idx] = { ...prev, ...normalized, text: nextText, readBy: nextReadBy, deliveryStatus: nextStatus };
  return copy;
}

/** Dedupe a server history page by id, preserving ascending order. */
export function uniqueMessages(list: Message[]): Message[] {
  const seen = new Set<string>();
  const out: Message[] = [];
  for (const row of list) {
    const id = messageKey(row.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ ...row, id });
  }
  return out;
}