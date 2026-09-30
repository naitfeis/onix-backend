import { describe, expect, it } from 'vitest';
import type { Message } from '../api/contracts';
import {
  appendUniqueMessage,
  compareMessageId,
  messageKey,
  newClientMessageId,
  uniqueMessages,
} from './messageOrder';

function msg(id: string, overrides: Partial<Message> = {}): Message {
  return {
    id,
    threadId: 'chat-1',
    kind: 'USER',
    sender: { id: overrides.mine ? '7' : '9', username: overrides.mine ? 'me' : 'peer' },
    text: `text-${id}`,
    createdAt: '2026-09-29T10:00:00.000Z',
    mine: false,
    ...overrides,
  } as Message;
}

describe('compareMessageId', () => {
  it('orders decimal id strings exactly beyond Number.MAX_SAFE_INTEGER', () => {
    // 20-digit ids are the realistic case: Number() collapses them to one value,
    // so the old `Number(a.id) - Number(b.id)` sort could not order them at all.
    const a = '12345678901234567890';
    const b = '12345678901234567891';
    expect(Number(a) - Number(b)).toBe(0);
    expect(compareMessageId(a, b)).toBe(-1);
    expect(compareMessageId(b, a)).toBe(1);
    expect(compareMessageId(a, a)).toBe(0);
  });

  it('compares by digit count first, so "9" precedes "10"', () => {
    expect(compareMessageId('9', '10')).toBeLessThan(0);
    expect(compareMessageId('100', '99')).toBeGreaterThan(0);
  });

  it('treats leading zeros as the same number', () => {
    expect(compareMessageId('007', '7')).toBe(0);
  });
});

describe('appendUniqueMessage dedupe', () => {
  it('ignores the same server id delivered twice', () => {
    const list = [msg('1'), msg('2')];
    const next = appendUniqueMessage(list, msg('2'));
    expect(next).toBe(list);
    expect(next.map((row) => row.id)).toEqual(['1', '2']);
  });

  it('collapses a pending placeholder into the server copy and adopts the server id', () => {
    const echo = msg('local-tmp', { mine: true, text: 'hello', pending: true });
    const list = [msg('1'), echo];
    const server = msg('42', { mine: true, text: 'hello' });
    const next = appendUniqueMessage(list, server);
    expect(next).toHaveLength(2);
    // Server id wins so later frames for the same message dedupe by id.
    expect(next.map((row) => row.id)).toEqual(['1', '42']);
    expect(next[1]!.pending).toBe(false);
  });

  it('keeps two identical committed messages — a real repeat, not an echo', () => {
    // Regression: the old fuzzy "same text within 4s" rule merged these into one,
    // silently losing a message that may be dispute evidence.
    const list = [msg('1', { mine: true, text: 'да' })];
    const next = appendUniqueMessage(list, msg('2', { mine: true, text: 'да' }));
    expect(next.map((row) => row.id)).toEqual(['1', '2']);
  });

  it('keeps an intentional duplicate with different text as a separate bubble', () => {
    const list = [msg('1', { text: 'same' })];
    const next = appendUniqueMessage(list, msg('2', { text: 'same' }));
    expect(next).toHaveLength(2);
  });

  it('keeps a deliberate repeated send outside the echo window as two messages', () => {
    const list = [msg('1', { text: 'same', createdAt: '2026-09-29T10:00:00.000Z' })];
    const later = msg('2', { text: 'same', createdAt: '2026-09-29T10:05:00.000Z' });
    const next = appendUniqueMessage(list, later);
    expect(next.map((row) => row.id)).toEqual(['1', '2']);
  });
});

describe('appendUniqueMessage ordering', () => {
  it('appends a newer id at the end', () => {
    const list = [msg('1'), msg('2')];
    expect(appendUniqueMessage(list, msg('3')).map((row) => row.id)).toEqual(['1', '2', '3']);
  });

  it('inserts an older id in place when a frame beats the history response', () => {
    // Realtime frame for id 2 arrives before the history GET that returned 1 and 3.
    const list = [msg('1'), msg('3')];
    const next = appendUniqueMessage(list, msg('2'));
    expect(next.map((row) => row.id)).toEqual(['1', '2', '3']);
  });

  it('inserts at the head when the frame is the oldest message', () => {
    const list = [msg('5'), msg('6')];
    const next = appendUniqueMessage(list, msg('1'));
    expect(next.map((row) => row.id)).toEqual(['1', '5', '6']);
  });

  it('does not mutate the input list', () => {
    const list = [msg('5'), msg('6')];
    const snapshot = list.map((row) => row.id);
    appendUniqueMessage(list, msg('1'));
    expect(list.map((row) => row.id)).toEqual(snapshot);
  });

  it('keeps ids sorted across a mixed inbound sequence', () => {
    let list: Message[] = [];
    for (const id of ['3', '1', '4', '2', '5']) list = appendUniqueMessage(list, msg(id));
    expect(list.map((row) => row.id)).toEqual(['1', '2', '3', '4', '5']);
  });
});

describe('uniqueMessages', () => {
  it('dedupes a history page by id and normalizes keys', () => {
    const rows = [msg('1'), msg('2'), msg('1'), msg('')];
    const out = uniqueMessages(rows);
    expect(out.map((row) => row.id)).toEqual(['1', '2']);
  });

  it('accepts ids that arrive as numbers and normalizes them to strings', () => {
    const rows = [{ id: 12 }, { id: '12' }] as unknown as Message[];
    expect(uniqueMessages(rows)).toHaveLength(1);
  });
});

describe('messageKey', () => {
  it('is empty for null/undefined so callers can skip the row', () => {
    expect(messageKey(null)).toBe('');
    expect(messageKey(undefined)).toBe('');
    expect(messageKey('7')).toBe('7');
  });
});

describe('newClientMessageId', () => {
  it('is unique per call so a deliberate resend is not deduplicated', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newClientMessageId()));
    expect(ids.size).toBe(200);
  });

  it('stays within the server-accepted length bound', () => {
    for (let i = 0; i < 50; i += 1) {
      const id = newClientMessageId();
      expect(id.length).toBeGreaterThanOrEqual(8);
      expect(id.length).toBeLessThanOrEqual(64);
    }
  });
});