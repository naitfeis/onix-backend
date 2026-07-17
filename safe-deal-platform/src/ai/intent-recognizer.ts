export type AiIntent =
  | 'CREATE_PRODUCT'
  | 'PUBLISH_PRODUCT'
  | 'EDIT_PRODUCT'
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
const FAQ_RE = /как\s+продавать|где\s+что|где\s+находится|систем[аеу]\s+гарант|гарант|escrow|сейф|вывод|сколько\s+ждать|поддержк|саппорт|support|жалоб|помощь|help|что\s+умеешь/i;

export class IntentRecognizer {
  recognize(text: string, opts?: { sessionReady?: boolean }): AiIntent {
    const raw = text.trim();
    if (!raw) return 'UNKNOWN';

    if (FUTURE_RE.test(raw)) return 'FUTURE';
    if (CANCEL_RE.test(raw)) return 'CANCEL';

    if (opts?.sessionReady) {
      if (PUBLISH_RE.test(raw)) return 'PUBLISH_PRODUCT';
      if (EDIT_RE.test(raw)) return 'EDIT_PRODUCT';
    }

    if (CREATE_EXACT_RE.test(raw) || CREATE_PREFIX_RE.test(raw)) return 'CREATE_PRODUCT';
    if (GREETING_RE.test(raw) || FAQ_RE.test(raw)) return 'HELP';
    return 'UNKNOWN';
  }
}
