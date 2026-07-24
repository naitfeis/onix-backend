import { useEffect, useState } from 'react';
import { api, friendlyError } from '../api/client';
import { API_PATHS } from '../api/contracts';

type Props = {
  attachment: {
    id: string;
    mimeType: string;
    originalName: string;
    sizeBytes: number;
  };
  onError?: (text: string) => void;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

export default function ChatAttachmentView({ attachment, onError }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const isImage = attachment.mimeType.startsWith('image/');

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    void api.get<{ url: string }>(API_PATHS.attachmentDownload(attachment.id))
      .then((data) => {
        if (!cancelled) setUrl(data.url);
      })
      .catch((error: unknown) => {
        if (!cancelled) onError?.(friendlyError(error));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => { cancelled = true; };
  }, [attachment.id, onError]);

  if (busy && !url) {
    return <p className="muted chat-attach-loading">Загрузка…</p>;
  }

  if (isImage && url) {
    return (
      <a className="chat-attach-image-link" href={url} target="_blank" rel="noreferrer">
        <img className="chat-attach-image" src={url} alt={attachment.originalName} loading="lazy" />
      </a>
    );
  }

  if (url) {
    return (
      <a className="chat-attach-file" href={url} target="_blank" rel="noreferrer">
        <span className="chat-attach-file__name">{attachment.originalName}</span>
        <span className="chat-attach-file__meta">{formatSize(attachment.sizeBytes)}</span>
      </a>
    );
  }

  return <p className="muted">Не удалось открыть файл</p>;
}
