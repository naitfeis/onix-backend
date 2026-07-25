import { useState } from 'react';
import {
  ADMIN_ASSIGNABLE_STATUS_OPTIONS, BAN_REASON_OPTIONS, PLATFORM_STATUS_OPTIONS,
  type BanReasonCode, type PlatformStatus,
} from '../api/contracts';
import { friendlyError } from '../api/client';
import { Button, Card, Confirm, Field, Input, Select, Textarea } from '../design-system';
import type { Core } from './types';

type SecurityFlag = {
  code: string;
  severity: string;
  userId: string;
  accountAgeDays: number;
  restrictedAccountSaleCents: string;
  protectionUntil: string;
};

export function Admin({ core, setToast }: { core: Core; setToast: (text: string) => void }) {
  const [userId, setUserId] = useState('');
  const [reason, setReason] = useState<BanReasonCode | ''>('');
  const [comment, setComment] = useState('');
  const [durationDays, setDurationDays] = useState('');
  const [confirmBan, setConfirmBan] = useState(false);
  const [confirmUnban, setConfirmUnban] = useState(false);
  const [status, setStatus] = useState<PlatformStatus>('USER');
  const [confirmStatus, setConfirmStatus] = useState(false);
  const [flagsBusy, setFlagsBusy] = useState(false);
  const [flags, setFlags] = useState<SecurityFlag[] | null>(null);
  const [flagsOnixId, setFlagsOnixId] = useState<string | null>(null);
  const reasonOption = BAN_REASON_OPTIONS.find(item => item.value === reason);
  const banReady = Boolean(userId.trim() && reason && comment.trim() && (reason !== 'OTHER' || Number(durationDays) > 0));
  const isSuperAdmin = core.profile?.status === 'SUPER_ADMIN';
  const statusOptions = isSuperAdmin ? PLATFORM_STATUS_OPTIONS : ADMIN_ASSIGNABLE_STATUS_OPTIONS;

  const loadFlags = async () => {
    const id = userId.trim();
    if (!id) return;
    setFlagsBusy(true);
    setFlags(null);
    setFlagsOnixId(null);
    try {
      const data = await core.loadSecurityFlags(id);
      setFlags(data.flags);
      setFlagsOnixId(data.onixId);
    } catch (error) {
      setToast(friendlyError(error));
    } finally {
      setFlagsBusy(false);
    }
  };

  return (
    <div className="stack compact">
      <Card className="admin-card">
        <h2>Security flags</h2>
        <p className="muted">
          Жёлтые сигналы проверки (не бан). Сейчас: защита средств от продажи аккаунта у новых пользователей.
        </p>
        <Field label="ONIX ID пользователя">
          <Input value={userId} onChange={event => setUserId(event.target.value)} placeholder="ONIX-7 или 7" />
        </Field>
        <div className="card-actions">
          <Button disabled={!userId.trim() || flagsBusy} onClick={() => void loadFlags()}>
            {flagsBusy ? 'Загрузка…' : 'Проверить флаги'}
          </Button>
        </div>
        {flags && (
          <div className="stack compact" style={{ marginTop: '0.75rem' }}>
            {flags.length === 0 ? (
              <p className="muted">Активных флагов нет{flagsOnixId ? ` (${flagsOnixId})` : ''}.</p>
            ) : (
              flags.map((flag) => (
                <div key={flag.code} className="stack compact">
                  <strong>{flag.severity}: {flag.code}</strong>
                  <p className="muted">
                    Возраст аккаунта: {flag.accountAgeDays} дн. · ограниченно ACCOUNT:{' '}
                    {(Number(flag.restrictedAccountSaleCents) / 100).toLocaleString('ru-RU')} ₽ · до{' '}
                    {new Date(flag.protectionUntil).toLocaleString('ru-RU')}
                  </p>
                </div>
              ))
            )}
          </div>
        )}
      </Card>
      <Card className="admin-card">
        <h2>Статусы</h2>
        <p className="muted">
          {isSuperAdmin
            ? 'Основатель может назначать ADMIN и остальные статусы. Действие пишется в audit log.'
            : 'ADMIN может выдавать USER / VERIFIED_SELLER / MODERATOR / VIP. Назначение ADMIN — только у Основателя.'}
        </p>
        <Field label="ONIX ID пользователя">
          <Input value={userId} onChange={event => setUserId(event.target.value)} placeholder="ONIX-7 или 7" />
        </Field>
        <Field label="Статус">
          <Select value={status} onChange={event => setStatus(event.target.value as PlatformStatus)}>
            {statusOptions.map(item => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </Select>
        </Field>
        <div className="card-actions">
          <Button disabled={!userId.trim()} onClick={() => setConfirmStatus(true)}>Выдать статус</Button>
        </div>
        <Confirm
          open={confirmStatus}
          dangerous={status === 'ADMIN' || status === 'SUPER_ADMIN'}
          title="Изменить статус?"
          text={`Пользователю будет назначен статус: ${PLATFORM_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status}. Операция запишется в журнал.`}
          busy={core.actionBusy === 'admin-status'}
          onCancel={() => setConfirmStatus(false)}
          onConfirm={async () => {
            if (await core.setUserStatus(userId.trim(), status)) {
              setConfirmStatus(false);
              setToast('Статус обновлён.');
            }
          }}
        />
      </Card>
      <Card className="admin-card">
        <h2>Модерация</h2>
        <p className="muted">Доступ показан только по роли, полученной от сервера.</p>
        <Field label="ONIX ID пользователя"><Input value={userId} onChange={event => setUserId(event.target.value)} placeholder="ONIX-7 или 7" /></Field>
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
      </Card>
    </div>
  );
}
export default Admin;
