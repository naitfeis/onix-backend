import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

/** Prevents a render crash from blanking the whole Mini App / Website shell. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          fontFamily: 'system-ui, sans-serif',
          background: '#0b0f14',
          color: '#e8eef5',
          textAlign: 'center',
        }}>
          <div>
            <h1 style={{ fontSize: 18, margin: '0 0 8px' }}>ONIX временно недоступен</h1>
            <p style={{ margin: '0 0 16px', opacity: 0.7, fontSize: 14 }}>
              Обновите страницу. Если ошибка повторяется — зайдите позже.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                border: '1px solid #3a4654',
                background: '#1a222c',
                color: '#e8eef5',
                borderRadius: 8,
                padding: '10px 16px',
                cursor: 'pointer',
              }}
            >
              Обновить
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
