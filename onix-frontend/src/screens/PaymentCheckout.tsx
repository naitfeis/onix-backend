import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { API_PATHS } from '../api/contracts';
import { Button, Modal } from '../design-system';
import QrImage from '../components/QrImage';

type IntentView = {
  id: string;
  status: string;
  metadata?: {
    paymentUrl?: string | null;
    qrPayload?: string | null;
    qrImageBase64?: string | null;
    payWay?: string;
    sandbox?: boolean;
  } | null;
};

const POLL_INTERVAL_MS = 2_500;

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
  /**
   * Callers pass inline arrow functions, so a ref keeps the polling effect
   * stable — otherwise every parent render tore down the interval and fired an
   * extra GET /api/payments/intents/:id.
   */
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!intentId) {
      setIntent(null);
      setError('');
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
          onDoneRef.current();
          return;
        }
        if (row.status === 'FAILED' || row.status === 'CANCELED' || row.status === 'EXPIRED') {
          stop();
          setError('Платёж не прошёл. Деньги не списаны — попробуйте ещё раз.');
        }
      } catch {
        // Keep polling: a transient API blip must not look like a failed payment.
      }
    };
    void tick();
    intervalId = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [intentId]);

  const meta = intent?.metadata;
  const terminalFailed = Boolean(error);
  return (
    <Modal open={Boolean(intentId)} title="Оплата" onClose={onCancel}>
      <div className="stack compact">
        {meta?.sandbox ? <p className="muted">Тестовый контур Т-Банка (Sandbox). Живые деньги не списываются.</p> : null}
        {meta?.qrPayload || meta?.qrImageBase64 ? (
          <p className="muted">Отсканируйте QR в приложении банка (СБП) или откройте ссылку оплаты.</p>
        ) : (
          <p className="muted">Откройте страницу оплаты банка. После оплаты баланс обновится сам.</p>
        )}
        <QrImage imageBase64={meta?.qrImageBase64} payload={meta?.qrPayload} />
        {meta?.paymentUrl ? (
          <Button
            variant="violet"
            onClick={() => window.open(meta.paymentUrl!, '_blank', 'noopener,noreferrer')}
          >
            Открыть оплату
          </Button>
        ) : null}
        {terminalFailed ? <p className="form-error" role="alert">{error}</p> : <p className="muted">Ждём подтверждение от банка…</p>}
        <div className="modal__actions">
          <Button variant="secondary" onClick={onCancel}>Закрыть</Button>
        </div>
      </div>
    </Modal>
  );
}