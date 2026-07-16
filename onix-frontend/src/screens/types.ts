import type { useOnixCore } from '../hooks/useOnixCore';

export type Core = ReturnType<typeof useOnixCore>;
export type Screen = 'market' | 'deals' | 'create' | 'chat' | 'profile';
