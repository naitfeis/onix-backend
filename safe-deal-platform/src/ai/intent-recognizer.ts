export type AiIntent =
  | 'CONTACT_SUPPORT'
  | 'HELP'
  | 'UNKNOWN';

/** JS \\b is ASCII-only — use explicit end markers for Cyrillic. */
const END = String.raw`(?:\s*[!.…]*\s*)$`;

const GREETING_RE = new RegExp(
  `^(?:привет|здравствуй(?:те)?|хай|hello|hi|пока|до\\s*свидания|bye)${END}`,
  'i',
);
/** Explicit support contact — must win over FAQ "поддержка". */
const CONTACT_SUPPORT_RE = /^(?:напиши|написать|обратиться|свяжись|связаться)\s+в\s+поддержк/i;
const FAQ_RE = /как\s+дела|как\s+ты|что\s+нового|о\s+площадке|что\s+такое\s+(?:оникс|onix)|про\s+(?:оникс|onix)|(?:оникс|onix)\s+это|о\s+(?:оникс|onix)|меню|как\s+продавать|добавить\s+товар|созда(?:й|ть)\s+товар|новый\s+товар|опубликовать|где\s+что|где\s+находится|навигац|систем[аеу]\s+гарант|гарант|escrow|сейф|вывести\s+деньги|вывод|сколько\s+ждать|поддержк|саппорт|support|жалоб|помощь|help|что\s+умеешь|комисс|залог|депозит|как\s+работает\s+поддержк/i;

export class IntentRecognizer {
  recognize(text: string): AiIntent {
    const raw = text.trim();
    if (!raw) return 'UNKNOWN';

    if (CONTACT_SUPPORT_RE.test(raw)) return 'CONTACT_SUPPORT';
    if (GREETING_RE.test(raw) || FAQ_RE.test(raw)) return 'HELP';
    return 'UNKNOWN';
  }
}

/** Strip the contact-support phrase; remainder is the ticket body. */
export function supportMessageBody(text: string): string {
  return text
    .trim()
    .replace(/^(?:напиши|написать|обратиться|свяжись|связаться)\s+в\s+поддержку[:\s—-]*/i, '')
    .trim();
}

export const SUPPORT_AWAIT_PROMPT =
  'Опишите проблему одним сообщением — я передам в поддержку ONIX. Ответ придёт сюда.';
