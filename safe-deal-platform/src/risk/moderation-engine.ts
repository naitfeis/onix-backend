/** Chat / profile / listing heuristics for the Moderation Engine. */

export type ModerationEventType =
  | 'OFF_PLATFORM_PAYMENT'
  | 'EXTERNAL_CONTACT'
  | 'SPAM'
  | 'DUPLICATE_LISTING'
  | 'SUSPICIOUS_LINK'
  | 'FRAUD_ATTEMPT';

export type ModerationAction = 'ALLOW' | 'MONITOR' | 'MODERATION' | 'SECURITY_LOCK' | 'BLOCK';

export type ModerationHit = {
  type: ModerationEventType;
  action: ModerationAction;
  reasons: string[];
};

const OFF_PLATFORM = [
  /переводи\s+напрямую/i,
  /напрямую\s+на\s+карт/i,
  /без\s+гарант/i,
  /давай\s+без\s+гарант/i,
  /кида[йи]\s+на\s+карт/i,
  /перевод(?:и|ом)?\s+(?:на\s+)?сбп/i,
  /outside\s+(?:the\s+)?(?:platform|onix)/i,
  /pay\s+directly/i,
];

const EXTERNAL_CONTACT = [
  /t(?:elegram)?\.me\//i,
  /(?:^|[^\w])@[\w]{4,}/,
  /discord(?:\.gg|app\.com)/i,
  /wa\.me\//i,
  /whats?app/i,
  /vk\.com\//i,
  /viber/i,
  /напиши\s+(?:мне\s+)?в\s+(?:тг|телег)/i,
];

const SUSPICIOUS_LINK = [
  /https?:\/\/(?!(?:www\.)?onixtg\.shop)[^\s]+/i,
  /bit\.ly\//i,
  /t\.co\//i,
];

const FRAUD_CODE = [
  /(?:код|code)\s*(?:из|from|подтвержд)/i,
  /2fa/i,
  /одноразов/i,
  /парол[ья]\s+(?:от\s+)?(?:почт|steam|telegram)/i,
];

const CARD_RE = /\b(?:\d[ -]*?){13,19}\b/;

export function inspectUserText(text: string): ModerationHit | null {
  const body = text.trim();
  if (!body) return null;
  const reasons: string[] = [];
  let type: ModerationEventType | null = null;
  let action: ModerationAction = 'ALLOW';

  if (OFF_PLATFORM.some((re) => re.test(body))) {
    type = 'OFF_PLATFORM_PAYMENT';
    reasons.push('off-platform payment phrasing');
    action = 'SECURITY_LOCK';
  }
  if (FRAUD_CODE.some((re) => re.test(body)) || CARD_RE.test(body)) {
    type = type ?? 'FRAUD_ATTEMPT';
    reasons.push('credentials or payment details');
    action = action === 'SECURITY_LOCK' ? 'SECURITY_LOCK' : 'BLOCK';
  }
  if (EXTERNAL_CONTACT.some((re) => re.test(body))) {
    type = type ?? 'EXTERNAL_CONTACT';
    reasons.push('external contact');
    if (action === 'ALLOW') action = 'MODERATION';
  }
  if (SUSPICIOUS_LINK.some((re) => re.test(body))) {
    type = type ?? 'SUSPICIOUS_LINK';
    reasons.push('suspicious link');
    if (action === 'ALLOW') action = 'MONITOR';
  }

  if (!type) return null;
  return { type, action, reasons };
}

export function inspectSpamBurst(recentSameCount: number): ModerationHit | null {
  if (recentSameCount < 5) return null;
  return {
    type: 'SPAM',
    action: recentSameCount >= 12 ? 'SECURITY_LOCK' : 'MODERATION',
    reasons: [`repeated identical messages (${recentSameCount})`],
  };
}

export function inspectDuplicateListing(_title: string, recentSameTitles: number): ModerationHit | null {
  if (recentSameTitles < 3) return null;
  return {
    type: 'DUPLICATE_LISTING',
    action: recentSameTitles >= 6 ? 'SECURITY_LOCK' : 'MODERATION',
    reasons: [`duplicate listing title (${recentSameTitles})`],
  };
}

export function strongerHit(a: ModerationHit | null, b: ModerationHit | null): ModerationHit | null {
  if (!a) return b;
  if (!b) return a;
  const rank: Record<ModerationAction, number> = {
    ALLOW: 0,
    MONITOR: 1,
    MODERATION: 2,
    SECURITY_LOCK: 3,
    BLOCK: 4,
  };
  return rank[b.action] > rank[a.action] ? b : a;
}
