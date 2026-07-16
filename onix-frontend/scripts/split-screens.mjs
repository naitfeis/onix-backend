import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', 'src');
const appPath = path.join(root, 'App.tsx');
const lines = fs.readFileSync(appPath, 'utf8').split(/\r?\n/);
const slice = (start1, end1) => lines.slice(start1 - 1, end1).join('\n');

fs.mkdirSync(path.join(root, 'screens'), { recursive: true });

const types = `import type { useOnixCore } from '../hooks/useOnixCore';

export type Core = ReturnType<typeof useOnixCore>;
export type Screen = 'market' | 'deals' | 'create' | 'chat' | 'profile';
`;

const sharedHeader = `import { useEffect, useState, type ReactNode } from 'react';
import { money } from '../api/client';
import {
  BAN_REASON_OPTIONS, CATEGORIES, SUBCATEGORIES_BY_CATEGORY,
  formatLastSeen, type BanReasonCode, type Deal, type OrderListStatus, type Product, type ProductDraft, type PublicProfile,
} from '../api/contracts';
import UserAvatar from '../components/UserAvatar';
import { Badge, Button, Card, Field, Modal, Select, StateView, Textarea } from '../design-system';
import type { Core } from './types';

export const emptyDraft: ProductDraft = {
  title: '', description: '', priceRubles: '', quantity: 1,
  category: CATEGORIES[0], subcategory: SUBCATEGORIES_BY_CATEGORY[CATEGORIES[0]][0],
  autoDeliver: false, deliveryText: '',
};

export const dealLabels: Record<Deal['status'], string> = {
  PENDING: 'Ожидает оплаты', PAYMENT_HOLD: 'Деньги в сейфе', DELIVERING: 'Передача товара',
  COMPLETED: 'Завершено', CANCELED: 'Отменено', DISPUTE: 'Открыт спор', REFUNDED: 'Возвращено',
};

export const DEAL_FILTERS: Array<{ id: string; label: string; status?: OrderListStatus }> = [
  { id: 'all', label: 'Все' },
  { id: 'open', label: 'Незавершённые', status: 'open' },
  { id: 'completed', label: 'Завершённые', status: 'completed' },
];

export function staffBadgeFromRoles(roles: Array<'USER' | 'ADMIN' | 'SUPPORT'>): 'ADMIN' | 'SUPPORT' | undefined {
  if (roles.includes('ADMIN')) return 'ADMIN';
  if (roles.includes('SUPPORT')) return 'SUPPORT';
  return undefined;
}

export function StaffBadge({ badge }: { badge?: 'ADMIN' | 'SUPPORT' }) {
  if (!badge) return null;
  return <span className="badge badge--staff">{badge}</span>;
}

export function MessageText({ text, onOpenOnix }: { text: string; onOpenOnix: (onixId: string) => void }) {
  const parts = text.split(/(ONIX-\\d+)/gi);
  return <>{parts.map((part, index) => {
    if (/^ONIX-\\d+$/i.test(part)) {
      const onixId = part.toUpperCase();
      return <button key={\`\${index}-\${onixId}\`} type="button" className="onix-id-link" onClick={() => onOpenOnix(onixId)}>{onixId}</button>;
    }
    return <span key={index}>{part}</span>;
  })}</>;
}

export function SectionHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return <div className="section-head"><div><h1>// {title}</h1><p>{subtitle}</p></div>{action}</div>;
}

export function dealProgress(status: Deal['status']) {
  return ({ PENDING: 0, PAYMENT_HOLD: 1, DELIVERING: 2, COMPLETED: 3, CANCELED: -1, DISPUTE: 1, REFUNDED: -1 })[status];
}
`;

function extractFn(startLine, endLine) {
  return slice(startLine, endLine).replace(/^function /, 'export function ');
}

fs.writeFileSync(path.join(root, 'screens/types.ts'), types);
fs.writeFileSync(
  path.join(root, 'screens/shared.tsx'),
  sharedHeader + '\n' + extractFn(864, 984) + '\n\n' + extractFn(986, 1022) + '\n',
);

fs.writeFileSync(
  path.join(root, 'screens/Market.tsx'),
  `import { useEffect, useState } from 'react';
import { api, money, friendlyError } from '../api/client';
import {
  API_PATHS, CATEGORIES, CATEGORY_LABELS, SUBCATEGORIES_BY_CATEGORY, SUBCATEGORY_LABELS,
  formatLastSeen, type Product, type PublicProfile,
} from '../api/contracts';
import UserAvatar from '../components/UserAvatar';
import { Badge, Button, Card, Confirm, Input, Modal, Select, Skeleton, StateView } from '../design-system';
import type { Core, Screen } from './types';
import { PublicProfileModal, StaffBadge } from './shared';

${extractFn(396, 625)}
export default Market;
`,
);

fs.writeFileSync(
  path.join(root, 'screens/ProductForm.tsx'),
  `import { useState, type FormEvent } from 'react';
import { CATEGORIES, CATEGORY_LABELS, SUBCATEGORIES_BY_CATEGORY, SUBCATEGORY_LABELS } from '../api/contracts';
import { Button, Card, Field, Input, Select, Textarea } from '../design-system';
import { validateDraft } from '../utils/productValidation';
import type { Core } from './types';
import { SectionHeader, emptyDraft } from './shared';

${extractFn(627, 669)}
export default ProductForm;
`,
);

fs.writeFileSync(
  path.join(root, 'screens/Deals.tsx'),
  `import { useEffect, useRef, useState } from 'react';
import { money } from '../api/client';
import type { Deal, OrderListQuery } from '../api/contracts';
import UserAvatar from '../components/UserAvatar';
import { Badge, Button, Card, Confirm, Field, Modal, Select, Skeleton, StateView, Textarea } from '../design-system';
import type { Core, Screen } from './types';
import { DEAL_FILTERS, SectionHeader, StaffBadge, dealLabels, dealProgress } from './shared';

${extractFn(757, 765)}

${extractFn(671, 751)}
export default Deals;
`,
);

fs.writeFileSync(
  path.join(root, 'screens/Chats.tsx'),
  `import { useEffect, useState } from 'react';
import { api, money } from '../api/client';
import { API_PATHS, formatLastSeen, type PublicProfile } from '../api/contracts';
import UserAvatar from '../components/UserAvatar';
import { Button, Card, Input, Skeleton, StateView } from '../design-system';
import type { Core } from './types';
import { MessageText, PublicProfileModal, ReportUserModal, SectionHeader, StaffBadge, dealLabels } from './shared';

${extractFn(767, 862)}
export default Chats;
`,
);

fs.writeFileSync(
  path.join(root, 'screens/Admin.tsx'),
  `import { useState } from 'react';
import { BAN_REASON_OPTIONS, type BanReasonCode } from '../api/contracts';
import { Button, Card, Confirm, Field, Input, Select, Textarea } from '../design-system';
import type { Core } from './types';

${extractFn(1160, 1194)}
export default Admin;
`,
);

let profileBody = extractFn(1024, 1120);
profileBody = profileBody.replace(
  "{section === 'admin' && profile.roles.includes('ADMIN') && <Admin core={core} setToast={setToast} />}",
  `{section === 'admin' && profile.roles.includes('ADMIN') && (
      <Suspense fallback={<Card><Skeleton lines={4} /></Card>}>
        <Admin core={core} setToast={setToast} />
      </Suspense>
    )}`,
);

fs.writeFileSync(
  path.join(root, 'screens/Profile.tsx'),
  `import { useEffect, useState, lazy, Suspense } from 'react';
import { api, money } from '../api/client';
import { API_PATHS, type Product, type ProductDraft, type PublicProfile } from '../api/contracts';
import UserAvatar from '../components/UserAvatar';
import { Badge, Button, Card, Field, Input, Modal, Skeleton, StateView, Textarea } from '../design-system';
import { validateDraft } from '../utils/productValidation';
import type { Core, Screen } from './types';
import { PublicProfileModal, StaffBadge, emptyDraft, staffBadgeFromRoles } from './shared';

const Admin = lazy(() => import('./Admin'));

${extractFn(1122, 1158)}

${profileBody}
export default Profile;
`,
);

fs.writeFileSync(
  path.join(root, 'screens/AuthGate.tsx'),
  `import { useEffect, useRef, useState } from 'react';
import { loginWithTelegram as legacyLoginWithTelegram, ApiError } from '../api/client';
import {
  getWebsiteAuthProvider,
  getWebsiteLoginProvider,
  isWebsiteAuthV2,
  openTelegramBotLogin,
  startBotLogin,
  waitAndCompleteBotLogin,
  AuthV2ApiError,
} from '../auth';
import { BotLoginError } from '../auth/botLogin';
import { formatBanRemaining, refreshBanInfo, type BanInfo } from '../api/contracts';
import { Button } from '../design-system';

type TelegramLoginPayload = Record<string, string | number>;

declare global {
  interface Window {
    onixTelegramAuth?: (user: TelegramLoginPayload) => Promise<void>;
    Telegram?: Record<string, unknown>;
    TelegramLoginWidget?: unknown;
  }
}

let reportTelegramLoginError: (message: string) => void = () => {};
let reportTelegramBan: (ban: BanInfo) => void = () => {};

function extractBanFromError(error: unknown): BanInfo | undefined {
  if (error instanceof AuthV2ApiError || error instanceof BotLoginError) {
    const ban = (error.details as { ban?: BanInfo } | undefined)?.ban;
    if (error.code === 'AUTH_ACCOUNT_LOCKED' && ban) return ban;
  }
  if (error instanceof ApiError) {
    const details = error.details as { ban?: BanInfo } | undefined;
    const ban = details?.ban;
    if (error.code === 'AUTH_ACCOUNT_LOCKED' && ban) return ban;
  }
  return undefined;
}

function registerOnixTelegramAuth() {
  if (window.onixTelegramAuth) return;
  window.onixTelegramAuth = async (user: TelegramLoginPayload) => {
    try {
      if (isWebsiteAuthV2()) {
        await getWebsiteAuthProvider().loginWithTelegram(user);
      } else {
        await legacyLoginWithTelegram(user);
      }
      location.reload();
    } catch (error) {
      const ban = extractBanFromError(error);
      if (ban) reportTelegramBan(ban);
      reportTelegramLoginError('Telegram вход не выполнен.');
    }
  };
}

${extractFn(264, 390)}
export default AuthNotice;
`,
);

console.log('OK: screens + AuthNotice written');
