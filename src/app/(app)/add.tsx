import { type Href, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, Icon, type IconName, ListItem, Text } from '@/components/ui';
import { type ColorScheme, makeStyles, useTheme } from '@/theme';

type AddKey =
  'expense' | 'income' | 'transfer' | 'refund' | 'budget' | 'bill' | 'recurring' | 'goal';

interface Option {
  key: AddKey;
  icon: IconName;
  tone: keyof ColorScheme;
  href: Href;
}

const RECORD: Option[] = [
  {
    key: 'expense',
    icon: 'arrow-up',
    tone: 'negative',
    href: '/transactions/new?type=expense' as Href,
  },
  {
    key: 'income',
    icon: 'arrow-down',
    tone: 'positive',
    href: '/transactions/new?type=income' as Href,
  },
  {
    key: 'transfer',
    icon: 'swap-horizontal',
    tone: 'primary',
    href: '/transactions/new?type=transfer' as Href,
  },
  {
    key: 'refund',
    icon: 'arrow-undo',
    tone: 'textSecondary',
    href: '/transactions/new?type=refund' as Href,
  },
];

const PLAN: Option[] = [
  { key: 'budget', icon: 'pie-chart-outline', tone: 'primary', href: '/budgets/new' as Href },
  { key: 'bill', icon: 'receipt-outline', tone: 'primary', href: '/bills/new' as Href },
  { key: 'recurring', icon: 'repeat', tone: 'primary', href: '/recurring/new' as Href },
  { key: 'goal', icon: 'flag-outline', tone: 'primary', href: '/goals/new' as Href },
];

/** Global Add sheet (centre "+"): record a transaction, plan ahead, or import. */
export default function AddSheet() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  const open = (href: Href) => {
    router.dismiss();
    router.push(href);
  };

  const tile = (o: Option) => (
    <Pressable
      key={o.key}
      accessibilityRole="button"
      accessibilityLabel={`${t(`add.${o.key}`)}. ${t(`add.${o.key}Hint`)}`}
      onPress={() => open(o.href)}
      style={({ pressed }) => [
        styles.tile,
        pressed && { backgroundColor: theme.colors.surfaceMuted },
      ]}
    >
      <View style={styles.tileIcon}>
        <Icon name={o.icon} size={22} tone={o.tone} />
      </View>
      <Text variant="bodyStrong" numberOfLines={1}>
        {t(`add.${o.key}`)}
      </Text>
      <Text variant="caption" tone="textSecondary" numberOfLines={1}>
        {t(`add.${o.key}Hint`)}
      </Text>
    </Pressable>
  );

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + theme.spacing.lg }]}>
      <Text variant="heading">{t('add.title')}</Text>

      <Text variant="label" tone="textSecondary" accessibilityRole="header">
        {t('add.recordSection')}
      </Text>
      <View style={styles.grid}>{RECORD.map(tile)}</View>

      <Text variant="label" tone="textSecondary" accessibilityRole="header">
        {t('add.planSection')}
      </Text>
      <View style={styles.grid}>{PLAN.map(tile)}</View>

      <Card padding="none">
        <ListItem
          icon="document-text-outline"
          title={t('add.importStatement')}
          subtitle={t('add.importStatementHint')}
          onPress={() => open('/data/import' as Href)}
        />
      </Card>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: { padding: t.spacing.lg, gap: t.spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm },
  tile: {
    flexBasis: '48%',
    flexGrow: 1,
    gap: t.spacing.xxs,
    padding: t.spacing.md,
    minHeight: 80,
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: t.colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: t.spacing.xs,
  },
}));
