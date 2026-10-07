import type { IconName } from '@/components/ui';
import { ACCOUNT_TYPES, type AccountType } from '@/domain/enums';
import { ACCOUNT_COLORS } from '@/theme';

/** Presentation metadata for accounts. Business rules live in domain/accounts. */

export const ACCOUNT_TYPE_ICONS: Record<AccountType, IconName> = {
  cash: 'cash-outline',
  checking: 'business-outline',
  savings: 'leaf-outline',
  credit_card: 'card-outline',
  debit_card: 'card',
  digital_wallet: 'phone-portrait-outline',
  loan: 'document-text-outline',
  other: 'ellipsis-horizontal-circle-outline',
};

export const DEFAULT_ACCOUNT_COLORS: Record<AccountType, string> = {
  cash: ACCOUNT_COLORS[1],
  checking: ACCOUNT_COLORS[0],
  savings: ACCOUNT_COLORS[2],
  credit_card: ACCOUNT_COLORS[3],
  debit_card: ACCOUNT_COLORS[9],
  digital_wallet: ACCOUNT_COLORS[4],
  loan: ACCOUNT_COLORS[6],
  other: ACCOUNT_COLORS[8],
};

/** Icons offered in the picker; `key` names the icon for screen readers. */
export const ACCOUNT_ICON_CHOICES = [
  { key: 'bank', icon: 'business-outline' },
  { key: 'cash', icon: 'cash-outline' },
  { key: 'wallet', icon: 'wallet-outline' },
  { key: 'card', icon: 'card-outline' },
  { key: 'savings', icon: 'leaf-outline' },
  { key: 'phone', icon: 'phone-portrait-outline' },
  { key: 'home', icon: 'home-outline' },
  { key: 'car', icon: 'car-outline' },
  { key: 'education', icon: 'school-outline' },
  { key: 'work', icon: 'briefcase-outline' },
  { key: 'investment', icon: 'trending-up-outline' },
  { key: 'safe', icon: 'shield-checkmark-outline' },
  { key: 'travel', icon: 'airplane-outline' },
  { key: 'gift', icon: 'gift-outline' },
  { key: 'globe', icon: 'globe-outline' },
  { key: 'loan', icon: 'document-text-outline' },
] as const satisfies readonly { key: string; icon: IconName }[];

export type AccountIconKey = (typeof ACCOUNT_ICON_CHOICES)[number]['key'];

export const ACCOUNT_COLOR_NAMES = [
  'blue',
  'green',
  'teal',
  'violet',
  'pink',
  'red',
  'orange',
  'amber',
  'slate',
  'navy',
] as const;

const KNOWN_ICONS = new Set<string>([
  ...ACCOUNT_ICON_CHOICES.map((c) => c.icon),
  ...Object.values(ACCOUNT_TYPE_ICONS),
]);

/** Stored icon if it is one we render, otherwise the type's default. */
export function resolveAccountIcon(type: AccountType, icon: string | null): IconName {
  return icon && KNOWN_ICONS.has(icon) ? (icon as IconName) : ACCOUNT_TYPE_ICONS[type];
}

export function resolveAccountColor(type: AccountType, color: string | null): string {
  return color && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : DEFAULT_ACCOUNT_COLORS[type];
}

export const ACCOUNT_TYPE_ORDER: readonly AccountType[] = ACCOUNT_TYPES;
