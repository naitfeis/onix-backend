import { humanPayload } from '../i18n';

export function RiskEvidence({
  payload,
  onOpenUser,
}: {
  payload: Record<string, unknown>;
  onOpenUser?: (onixId: string) => void;
}) {
  const lines = humanPayload(payload);
  const banned = Array.isArray(payload.bannedAccounts) ? payload.bannedAccounts : [];
  return (
    <ul>
      {lines.filter((line) => !line.startsWith('Забаненный аккаунт:')).map((line) => (
        <li key={line}>{line}</li>
      ))}
      {banned.map((hit) => {
        if (!hit || typeof hit !== 'object') return null;
        const row = hit as { onixId?: unknown; via?: unknown };
        if (typeof row.onixId !== 'string') return null;
        const how = row.via === 'device' ? 'то же устройство' : row.via === 'ip' ? 'тот же адрес' : row.via === 'telegram' ? 'тот же Telegram' : 'совпадение';
        return (
          <li key={`${row.onixId}-${String(row.via)}`}>
            Забаненный аккаунт:{' '}
            {onOpenUser ? (
              <button className="link-button" type="button" onClick={() => onOpenUser(row.onixId as string)}>{row.onixId}</button>
            ) : row.onixId}
            {` (${how})`}
          </li>
        );
      })}
    </ul>
  );
}
