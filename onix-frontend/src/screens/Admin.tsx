import { useState } from 'react';
import { BAN_REASON_OPTIONS, type BanReasonCode } from '../api/contracts';
import { Button, Card, Confirm, Field, Input, Select, Textarea } from '../design-system';
import type { Core } from './types';

export function Admin({ core, setToast }: { core: Core; setToast: (text: string) => void }) {
  const [userId, setUserId] = useState('');
  const [reason, setReason] = useState<BanReasonCode | ''>('');
  const [comment, setComment] = useState('');
  const [durationDays, setDurationDays] = useState('');
  const [confirmBan, setConfirmBan] = useState(false);
  const [confirmUnban, setConfirmUnban] = useState(false);
  const reasonOption = BAN_REASON_OPTIONS.find(item => item.value === reason);
  const banReady = Boolean(userId.trim() && reason && comment.trim() && (reason !== 'OTHER' || Number(durationDays) > 0));
  return <Card className="admin-card"><h2>// ADMIN · МОДЕРАЦИЯ</h2><p className="muted">Доступ показан только по роли, полученной от сервера.</p>
    <Field label="ONIX ID пользователя"><Input value={userId} onChange={event => setUserId(event.target.value)} placeholder="ONIX-000007" /></Field>
    <Field label="Причина блокировки" hint={reasonOption?.hint}>
      <Select value={reason} onChange={event => setReason(event.target.value as BanReasonCode | '')}>
        <option value="">Выберите причину</option>
        {BAN_REASON_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </Select>
    </Field>
    {reason === 'OTHER' && <Field label="Срок, дней"><Input type="number" min={1} value={durationDays} onChange={event => setDurationDays(event.target.value)} /></Field>}
    <Field label="Комментарий"><Textarea required maxLength={500} value={comment} onChange={event => setComment(event.target.value)} /></Field>
    <div className="card-actions">
      <Button variant="danger" disabled={!banReady} onClick={() => setConfirmBan(true)}>Заблокировать</Button>
      <Button variant="secondary" disabled={!userId.trim()} onClick={() => setConfirmUnban(true)}>Разблокировать</Button>
    </div>
    <Confirm open={confirmBan} dangerous title="Заблокировать пользователя?" text="Операция будет записана в журнал администратора." busy={core.actionBusy === 'admin-ban'} onCancel={() => setConfirmBan(false)} onConfirm={async () => {
      if (reason && comment.trim() && await core.adminAction('ban', userId.trim(), {
        reason,
        comment: comment.trim(),
        ...(reason === 'OTHER' && durationDays ? { durationDays: Number(durationDays) } : {}),
      })) { setConfirmBan(false); setToast('Действие администратора выполнено.'); }
    }} />
    <Confirm open={confirmUnban} title="Снять блокировку?" text="Пользователь снова сможет войти в ONIX." busy={core.actionBusy === 'admin-unban'} onCancel={() => setConfirmUnban(false)} onConfirm={async () => {
      if (await core.adminAction('unban', userId.trim())) { setConfirmUnban(false); setToast('Действие администратора выполнено.'); }
    }} />
  </Card>;
}
export default Admin;
