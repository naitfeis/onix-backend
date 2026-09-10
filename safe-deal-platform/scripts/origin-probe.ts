/**
 * Live origin perimeter probe — archives evidence under ops-drills/ (gitignored)
 * and a redacted copy under docs/architecture/ops-evidence/ (committable).
 *
 * Usage:
 *   npm run ops:origin-probe
 *   $env:ORIGIN_PROBE_IP="158.160.116.199"; npm run ops:origin-probe
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ip = (process.env.ORIGIN_PROBE_IP ?? '158.160.116.199').trim();
const domain = (process.env.ORIGIN_PROBE_HOST ?? 'www.onixtg.shop').trim();
const outDir = resolve(process.cwd(), 'ops-drills');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

type Probe = {
  name: string;
  url: string;
  hostHeader: string;
  status: number | null;
  error?: string;
};

function curlStatus(url: string, hostHeader: string): Probe {
  const curl = process.platform === 'win32' ? 'curl.exe' : 'curl';
  const r = spawnSync(
    curl,
    ['-sS', '-o', 'NUL', '-w', '%{http_code}', '-k', url, '-H', `Host: ${hostHeader}`, '--connect-timeout', '12'],
    { encoding: 'utf8' },
  );
  const code = Number((r.stdout ?? '').trim());
  if (r.error || r.status !== 0 || !Number.isFinite(code)) {
    return {
      name: '',
      url,
      hostHeader,
      status: null,
      error: r.error?.message || r.stderr?.trim() || `curl exit ${r.status}`,
    };
  }
  return { name: '', url, hostHeader, status: code };
}

function main(): void {
  mkdirSync(outDir, { recursive: true });
  const baseIp = `https://${ip}`;
  const specs: Array<{ name: string; url: string; host: string }> = [
    { name: 'literal-ip-host-health', url: `${baseIp}/api/health/live`, host: ip },
    { name: 'literal-ip-host-api', url: `${baseIp}/api/v2/auth/me`, host: ip },
    { name: 'spoof-host-health', url: `${baseIp}/api/health/live`, host: domain },
    { name: 'spoof-host-api', url: `${baseIp}/api/v2/auth/me`, host: domain },
    { name: 'canonical-domain-health', url: `https://${domain}/api/health/live`, host: domain },
  ];
  const results: Probe[] = specs.map((s) => {
    const p = curlStatus(s.url, s.host);
    return { ...p, name: s.name };
  });

  const byName = Object.fromEntries(results.map((r) => [r.name, r]));
  const literalClosed =
    byName['literal-ip-host-health']?.status !== 200
    && byName['literal-ip-host-api']?.status !== 200;
  const spoofServesApp =
    byName['spoof-host-health']?.status === 200
    || byName['spoof-host-api']?.status === 401
    || byName['spoof-host-api']?.status === 200;
  const domainOk = byName['canonical-domain-health']?.status === 200;

  const verdict = !literalClosed
    ? 'BLOCK'
    : spoofServesApp
      ? 'OPEN_GREY_CLOUD_DNS_EQUIVALENT'
      : 'CLOSED';

  const report = {
    ok: verdict === 'CLOSED' || verdict === 'OPEN_GREY_CLOUD_DNS_EQUIVALENT',
    moneyLaunchGate: verdict === 'CLOSED'
      ? 'PASS'
      : verdict === 'OPEN_GREY_CLOUD_DNS_EQUIVALENT'
        ? 'PASS_WITH_ORIGIN_GREY_CLOUD_ACK'
        : 'FAIL',
    verdict,
    stampedAt: new Date().toISOString(),
    probes: results,
    interpretation: {
      literalIpHost: literalClosed
        ? 'CLOSED — Host:<ip> does not serve the app'
        : 'OPEN — Host:<ip> still returns 200',
      spoofHostViaIp: spoofServesApp
        ? 'DNS-equivalent on grey-cloud (A→IP). Not CF WAF bypass — CF is DNS-only. Close with ORIGIN_EDGE_SECRET + Amvera allowlist, or set ORIGIN_GREY_CLOUD_ACK.'
        : 'CLOSED — IP+Host:www does not serve app',
      canonicalDomain: domainOk ? 'OK' : 'DOWN',
    },
    requiredEnvForMoneyLaunch: spoofServesApp
      ? ['ORIGIN_GREY_CLOUD_ACK=grey-cloud-accepted', 'AMVERA=1', 'ALLOWED_HOSTS=www.onixtg.shop,onixtg.shop']
      : ['ALLOWED_HOSTS=www.onixtg.shop,onixtg.shop'],
  };

  const path = resolve(outDir, `origin-probe-${stamp}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const evidenceDir = resolve(process.cwd(), 'docs/architecture/ops-evidence');
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(
    resolve(evidenceDir, 'origin-probe-latest.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );

  console.log(JSON.stringify({ ...report, archived: path }, null, 2));
  if (verdict === 'BLOCK') process.exitCode = 1;
}

main();
