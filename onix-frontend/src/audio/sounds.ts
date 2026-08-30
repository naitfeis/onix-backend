type SoundName = 'notify' | 'order';

const SRC: Record<SoundName, string> = {
  notify: '/sounds/notify.mp3',
  order: '/sounds/order.mp3',
};

let unlocked = false;
const players = new Map<SoundName, HTMLAudioElement>();

function player(name: SoundName): HTMLAudioElement {
  let audio = players.get(name);
  if (!audio) {
    audio = new Audio(SRC[name]);
    audio.preload = 'auto';
    players.set(name, audio);
  }
  return audio;
}

export function unlockSounds(): void {
  if (unlocked || typeof window === 'undefined') return;
  unlocked = true;
  for (const name of Object.keys(SRC) as SoundName[]) {
    const audio = player(name);
    audio.muted = true;
    void audio.play().then(() => {
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
    }).catch(() => {
      unlocked = false;
    });
  }
}

export function playSound(name: SoundName): void {
  if (typeof window === 'undefined') return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  const audio = player(name);
  audio.currentTime = 0;
  void audio.play().catch(() => {
    unlocked = false;
  });
}

export function isOrderNotification(title?: string, body?: string): boolean {
  const text = `${title ?? ''} ${body ?? ''}`.toLowerCase();
  return /покупк|заказ|оплатил/.test(text);
}
