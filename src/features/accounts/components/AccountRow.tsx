import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Badge, Icon, MoneyText, Text } from '@/components/ui';
import type { Account } from '@/domain/models';
import type { Money } from '@/domain/money/money';
import { useFormatter } from '@/i18n/FormatContext';
import { makeStyles, useTheme } from '@/theme';

import { AccountIcon } from './AccountIcon';

export interface AccountRowProps {
  account: Pick<Account, 'id' | 'name' | 'type' | 'icon' | 'color' | 'isArchived' | 'currency'>;
  balance: Money;
  onPress?: () => void;
}

export function AccountRow({ account, balance, onPress }: AccountRowProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const formatter = useFormatter();
  const typeLabel = t(`accounts.types.${account.type}`);
  const a11yLabel = [
    account.name,
    typeLabel,
    account.isArchived ? t('accounts.archivedBadge') : null,
    formatter.money(balance),
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: theme.colors.surfaceMuted },
      ]}
    >
      <AccountIcon type={account.type} icon={account.icon} color={account.color} />
      <View style={styles.body}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {account.name}
        </Text>
        <View style={styles.meta}>
          <Text variant="bodySmall" tone="textSecondary" numberOfLines={1}>
            {typeLabel}
          </Text>
          {account.isArchived ? <Badge label={t('accounts.archivedBadge')} /> : null}
        </View>
      </View>
      <MoneyText value={balance} numberOfLines={1} />
      {onPress ? <Icon name="chevron-forward" size={18} tone="textMuted" /> : null}
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
    minHeight: 64,
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.lg,
  },
  body: { flex: 1, gap: t.spacing.xxs },
  meta: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
}));
