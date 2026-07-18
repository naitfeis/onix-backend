export type AiIntent =
  | 'CREATE_PRODUCT'
  | 'PUBLISH_PRODUCT'
  | 'EDIT_PRODUCT'
  | 'CONTACT_SUPPORT'
  | 'WITHDRAW'
  | 'HELP'
  | 'FUTURE'
  | 'CANCEL'
  | 'UNKNOWN';

/** JS \\b is ASCII-only — use explicit end markers for Cyrillic. */
const END = String.raw`(?:\s*[!.…]*\s*)$`;

const CREATE_EXACT_RE = new RegExp(
  `^(?:создай\\s+(?:новый\\s+)?товар|новый\\s+товар|создать\\s+(?:новый\\s+)?товар|добавить\\s+товар)${END}`,
  'i',
);
const CREATE_PREFIX_RE = /^(?:создай\s+(?:новый\s+)?товар|новый\s+товар|добавить\s+товар)(?:\s|$)/i;
const FUTURE_RE = /создай\s+товар\s+как\s+вчера|как\s+вчера|повторить\s+вчера/i;
const PUBLISH_RE = new RegExp(`^(?:опубликовать|опубликуй|да|подтверждаю|готово)${END}`, 'i');
const EDIT_RE = new RegExp(`^(?:изменить|измени|заново|редактировать)${END}`, 'i');
const CANCEL_RE = new RegExp(`^(?:отмена|отменить|стоп|cancel)${END}`, 'i');
const GREETING_RE = new RegExp(
  `^(?:привет|здравствуй(?:те)?|хай|hello|hi|пока|до\\s*свидания|bye)${END}`,
  'i',
);
/** Explicit support contact — must win over FAQ "поддержка". */
const CONTACT_SUPPORT_RE = /^(?:напиши|написать|обратиться|свяжись|связаться)\s+в\s+поддержк/i;
/** Start withdrawal wizard (not FAQ "сколько ждать вывод"). */
const WITHDRAW_RE = /^(?:вывести\s+деньги|вывод\s+средств|вывести)(?:\s|$|:|！|!|\.)/i;
const FAQ_RE = /как\s+дела|как\s+ты|что\s+нового|о\s+площадке|что\s+такое\s+(?:оникс|onix)|про\s+(?:оникс|onix)|(?:оникс|onix)\s+это|о\s+(?:оникс|onix)|меню|как\s+продавать|где\s+что|где\s+находится|навигац|систем[аеу]\s+гарант|гарант|escrow|сейф|сколько\s+ждать|поддержк|саппорт|support|жалоб|помощь|help|что\s+умеешь|комисс|залог|депозит|как\s+работает\s+поддержк/i;

export class IntentRecognizer {
  recognize(text: string, opts?: { sessionReady?: boolean }): AiIntent {
    const raw = text.trim();
    if (!raw) return 'UNKNOWN';

    if (FUTURE_RE.test(raw)) return 'FUTURE';
    if (CANCEL_RE.test(raw)) return 'CANCEL';
    if (CONTACT_SUPPORT_RE.test(raw)) return 'CONTACT_SUPPORT';
    if (WITHDRAW_RE.test(raw)) return 'WITHDRAW';

    if (opts?.sessionReady) {
      if (PUBLISH_RE.test(raw)) return 'PUBLISH_PRODUCT';
      if (EDIT_RE.test(raw)) return 'EDIT_PRODUCT';
    }

    if (CREATE_EXACT_RE.test(raw) || CREATE_PREFIX_RE.test(raw)) return 'CREATE_PRODUCT';
    if (GREETING_RE.test(raw) || FAQ_RE.test(raw)) return 'HELP';
    // "вывод" alone as FAQ timing question
    if (/вывод/i.test(raw) && /ждать|когда|сколько|срок/i.test(raw)) return 'HELP';
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

export const WITHDRAW_AMOUNT_PROMPT =
  'Введите сумму вывода в рублях (минимум 1 ₽).';

export const WITHDRAW_METHOD_PROMPT =
  'Укажите способ вывода: карта · СБП · крипто';

export const WITHDRAW_CARD_PROMPT =
  'Введите реквизиты (номер карты / телефон СБП / адрес кошелька).';
