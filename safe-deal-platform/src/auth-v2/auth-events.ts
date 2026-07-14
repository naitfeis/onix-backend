export type AuthDomainEventName =
  | 'UserLoggedIn.v1'
  | 'UserLoginFailed.v1'
  | 'SessionCreated.v1'
  | 'SessionRevoked.v1'
  | 'Logout.v1'
  | 'LogoutAll.v1'
  | 'RefreshRotated.v1'
  | 'RefreshReuseDetected.v1'
  | 'SessionsGloballyInvalidated.v1';

export interface AuthDomainEvent {
  name: AuthDomainEventName;
  occurredAt: string;
  payload: Record<string, unknown>;
}

type Listener = (event: AuthDomainEvent) => void | Promise<void>;

/**
 * In-process domain event bus (ADR-012 / ADR-038).
 * Side effects (notify, analytics) subscribe here — Auth does not call them directly.
 */
export class AuthEventPublisher {
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async publish(name: AuthDomainEventName, payload: Record<string, unknown>): Promise<void> {
    const event: AuthDomainEvent = {
      name,
      occurredAt: new Date().toISOString(),
      payload,
    };
    for (const listener of this.listeners) {
      await listener(event);
    }
  }
}

export const AUTH_EVENT_PUBLISHER = Symbol('AUTH_EVENT_PUBLISHER');
