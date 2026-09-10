/**
 * Pure origin-access policy helpers (unit-tested).
 * Network allowlisting is still required to stop raw-IP + Host:www on grey-cloud.
 */

export function isLiteralIpHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (!h) return false;
  return /^(?:\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-f:]+\]?$/i.test(h);
}

export function parseAllowedHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.ALLOWED_HOSTS?.trim()
    || env.PUBLIC_WEB_HOST?.trim()
    || 'www.onixtg.shop,onixtg.shop';
  return raw
    .split(',')
    .map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0]!.split(':')[0]!)
    .filter(Boolean);
}

export function originHostAllowed(
  hostHeader: string | undefined,
  allowed: string[],
): boolean {
  const host = String(hostHeader ?? '').split(':')[0]?.toLowerCase() ?? '';
  if (!host) return false;
  if (isLiteralIpHost(host)) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  return allowed.includes(host);
}

/** TLS SNI when Node terminates TLS; undefined behind Amvera/LB termination. */
export function tlsServerName(socket: { servername?: string } | null | undefined): string | undefined {
  const sni = socket?.servername;
  return typeof sni === 'string' && sni.trim() ? sni.trim().toLowerCase() : undefined;
}

/**
 * Reject when TLS SNI is a literal IP even if Host is an allowed domain.
 * Closes curl https://IP -H "Host: www…" when Node sees TLS (not when LB strips TLS).
 */
export function originSniAllowed(
  sni: string | undefined,
  allowed: string[],
): boolean {
  if (!sni) return true; // no SNI signal (HTTP behind LB) — Host policy applies alone
  const host = sni.split(':')[0]!.toLowerCase();
  if (isLiteralIpHost(host)) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  return allowed.includes(host);
}

export function isHealthPath(path: string): boolean {
  return path === '/api/health/live'
    || path === '/api/health/ready'
    || path === '/health/live'
    || path === '/health/ready';
}

/**
 * Production launch posture for grey-cloud Amvera.
 * Either an edge secret is configured, or ops explicitly ACK that public IP == DNS entry.
 */
export function originLaunchPosture(env: NodeJS.ProcessEnv = process.env): {
  ok: boolean;
  mode: 'edge-secret' | 'grey-cloud-ack' | 'unacked-public-ip';
  detail: string;
} {
  if (env.ORIGIN_EDGE_SECRET?.trim()) {
    return {
      ok: true,
      mode: 'edge-secret',
      detail: 'ORIGIN_EDGE_SECRET set — clients without X-ONIX-Edge-Secret are rejected',
    };
  }
  const ack = (env.ORIGIN_GREY_CLOUD_ACK ?? '').trim().toLowerCase();
  if (ack === '1' || ack === 'true' || ack === 'grey-cloud-accepted') {
    return {
      ok: true,
      mode: 'grey-cloud-ack',
      detail: 'ORIGIN_GREY_CLOUD_ACK set — public IP with Host:www is accepted as DNS-equivalent entry',
    };
  }
  return {
    ok: false,
    mode: 'unacked-public-ip',
    detail:
      'Set ORIGIN_EDGE_SECRET (with an edge that injects X-ONIX-Edge-Secret) '
      + 'or ORIGIN_GREY_CLOUD_ACK=grey-cloud-accepted after Amvera firewall review',
  };
}
