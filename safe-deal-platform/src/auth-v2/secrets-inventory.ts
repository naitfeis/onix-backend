/**
 * Slice 5 — startup secrets inventory.
 * Reports present/missing by **name only**. Never returns or logs secret values.
 */

export type SecretInventoryStatus = 'present' | 'missing';

export type SecretInventoryItem = {
  name: string;
  status: SecretInventoryStatus;
  /** When true, production (or always) should treat missing as operator attention. */
  required: boolean;
  domain: 'ed25519' | 'device' | 'legacy_jwt' | 'delivery' | 'telegram' | 'optional_rotation' | 'admin';
};

type SecretSpec = {
  name: string;
  required: boolean | 'production';
  domain: SecretInventoryItem['domain'];
};

const SECRET_SPECS: readonly SecretSpec[] = [
  { name: 'AUTH_ED25519_CURRENT_KID', required: true, domain: 'ed25519' },
  { name: 'AUTH_ED25519_CURRENT_PRIVATE_PEM', required: true, domain: 'ed25519' },
  { name: 'AUTH_ED25519_CURRENT_PUBLIC_PEM', required: true, domain: 'ed25519' },
  { name: 'AUTH_ED25519_PREVIOUS_KID', required: false, domain: 'optional_rotation' },
  { name: 'AUTH_ED25519_PREVIOUS_PUBLIC_PEM', required: false, domain: 'optional_rotation' },
  { name: 'DEVICE_HMAC_SECRET', required: 'production', domain: 'device' },
  { name: 'JWT_SECRET', required: true, domain: 'legacy_jwt' },
  { name: 'PRODUCT_DELIVERY_KEY', required: false, domain: 'delivery' },
  { name: 'BOT_TOKEN', required: true, domain: 'telegram' },
  { name: 'TELEGRAM_WEBHOOK_SECRET', required: false, domain: 'telegram' },
  { name: 'ADMIN_IP_ALLOWLIST', required: false, domain: 'admin' },
];

type EnvMap = Record<string, string | undefined>;

function isPresent(name: string, env: EnvMap = process.env): boolean {
  const value = env[name];
  return value !== undefined && value.trim() !== '';
}

function isRequired(spec: SecretSpec, nodeEnv: string | undefined): boolean {
  if (spec.required === true) return true;
  if (spec.required === 'production') return nodeEnv === 'production';
  return false;
}

/** Assess configured secrets — names and status only. */
export function assessSecrets(
  env: EnvMap = process.env,
  nodeEnv: string | undefined = env.NODE_ENV,
): SecretInventoryItem[] {
  return SECRET_SPECS.map((spec) => ({
    name: spec.name,
    status: isPresent(spec.name, env) ? 'present' : 'missing',
    required: isRequired(spec, nodeEnv),
    domain: spec.domain,
  }));
}

/** One-line operator summary — never includes secret values. */
export function formatSecretsInventoryLine(
  items: SecretInventoryItem[] = assessSecrets(),
): string {
  const missingRequired = items.filter((i) => i.required && i.status === 'missing').map((i) => i.name);
  const missingOptional = items.filter((i) => !i.required && i.status === 'missing').map((i) => i.name);
  const present = items.filter((i) => i.status === 'present').map((i) => i.name);
  const parts = [
    `secrets_inventory present=${present.length}`,
    missingRequired.length ? `missing_required=[${missingRequired.join(',')}]` : 'missing_required=[]',
    missingOptional.length ? `missing_optional=[${missingOptional.join(',')}]` : 'missing_optional=[]',
  ];
  return parts.join(' ');
}

/**
 * Startup check — never throws, never logs values.
 */
export function logSecretsInventory(log: {
  log: (m: string) => void;
  warn: (m: string) => void;
}): void {
  const items = assessSecrets();
  const line = formatSecretsInventoryLine(items);
  const missingRequired = items.filter((i) => i.required && i.status === 'missing');
  if (missingRequired.length) {
    log.warn(line);
  } else {
    log.log(line);
  }
}
