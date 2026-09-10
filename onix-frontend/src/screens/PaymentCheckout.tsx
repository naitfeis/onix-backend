import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { API_PATHS } from '../api/contracts';
import { Button, Modal } from '../design-system';

type IntentView = {
  id: string;
  status: string;
  metadata?: {
    paymentUrl?: string | null;
    qrPayload?: string | null;
    payWay?: string;
    sandbox?: boolean;
  } | null;
};

export default function PaymentCheckout({
  intentId,
  onDone,
  onCancel,
}: {
  intentId: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [intent, setIntent] = useState<IntentView | null>(null);
  const [error, setError] = useState('');
  const doneRef = useRef(false);

  useEffect(() => {
    if (!intentId) {
      setIntent(null);
      doneRef.current = false;
      return;
    }
    let cancelled = false;
    let intervalId = 0;
    const stop = () => {
      if (intervalId) window.clearInterval(intervalId);
      intervalId = 0;
    };
    const tick = async () => {
      try {
        const row = await api.get<IntentView>(API_PATHS.paymentIntent(intentId));
        if (cancelled) return;
        setIntent(row);
        if (row.status === 'SUCCEEDED' && !doneRef.current) {
          doneRef.current = true;
          stop();
          onDone();
        }
        if (row.status === 'FAILED' || row.status === 'CANCELED' || row.status === 'EXPIRED') {
          stop();
          setError('Платёж не прошёл. Попробуйте ещё раз.');
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Не удалось проверить платёж.');
      }
    };
    void tick();
    intervalId = window.setInterval(() => void tick(), 2500);
    return () => {
      cancelled = true;
      stop();
    };
  }, [intentId, onDone]);

  const meta = intent?.metadata;
  return (
    <Modal open={Boolean(intentId)} title="Оплата" onClose={onCancel}>
      <div className="stack compact">
        {meta?.sandbox ? <p className="muted">Тестовый контур Т-Банка (Sandbox). Живые деньги не списываются.</p> : null}
        {meta?.qrPayload ? (
          <p className="muted">Отсканируйте QR в приложении банка (СБП) или откройте ссылку оплаты.</p>
        ) : (
          <p className="muted">Откройте страницу оплаты Т-Банка. После оплаты баланс обновится сам.</p>
        )}
        {meta?.qrPayload ? (
          <p className="payment-qr-payload">{meta.qrPayload}</p>
        ) : null}
        {meta?.paymentUrl ? (
          <Button
            variant="violet"
            onClick={() => window.open(meta.paymentUrl!, '_blank', 'noopener,noreferrer')}
          >
            Открыть оплату
          </Button>
        ) : null}
        {error ? <p className="muted">{error}</p> : <p className="muted">Ждём подтверждение от банка…</p>}
        <div className="modal__actions">
          <Button variant="secondary" onClick={onCancel}>Закрыть</Button>
        </div>
      </div>
    </Modal>
  );
}
