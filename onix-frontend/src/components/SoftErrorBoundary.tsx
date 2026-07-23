import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  /** Shown above the retry button */
  label?: string;
};

type State = { error: Error | null };

/**
 * Local boundary — chunk/import failures must not blank the whole ONIX shell.
 */
export class SoftErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[SoftErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      const label = this.props.label ?? 'Не удалось загрузить блок';
      return (
        <div
          role="alert"
          style={{
            padding: 16,
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(0,0,0,0.35)',
            color: '#e8eef5',
            fontFamily: 'system-ui, sans-serif',
            fontSize: 14,
            textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 12px', opacity: 0.85 }}>{label}</p>
          <button
            type="button"
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
            style={{
              border: '1px solid #3a4654',
              background: '#1a222c',
              color: '#e8eef5',
              borderRadius: 8,
              padding: '8px 14px',
              cursor: 'pointer',
            }}
          >
            Обновить
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default SoftErrorBoundary;
