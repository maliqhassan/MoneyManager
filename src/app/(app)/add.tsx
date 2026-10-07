import { type Href, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Divider, type IconName, ListItem, Text } from '@/components/ui';
import { makeStyles } from '@/theme';

const OPTIONS: {
  type: 'expense' | 'income' | 'transfer' | 'refund';
  icon: IconName;
  hint: 'add.expenseHint' | 'add.incomeHint' | 'add.transferHint' | 'add.refundHint';
}[] = [
  { type: 'expense', icon: 'arrow-up-circle-outline', hint: 'add.expenseHint' },
  { type: 'income', icon: 'arrow-down-circle-outline', hint: 'add.incomeHint' },
  { type: 'transfer', icon: 'swap-horizontal-outline', hint: 'add.transferHint' },
  { type: 'refund', icon: 'arrow-undo-outline', hint: 'add.refundHint' },
];

/** Global Add sheet (centre tab button) → the matching transaction form. */
export default function AddSheet() {
  const { t } = useTranslation();
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  const open = (type: (typeof OPTIONS)[number]['type']) => {
    router.dismiss();
    router.push(`/transactions/new?type=${type}` as Href);
  };

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 16 }]}>
      <Text variant="heading">{t('add.title')}</Text>
      <Card padding="none">
        {OPTIONS.map((option, index) => (
          <View key={option.type}>
            {index > 0 ? <Divider inset={64} /> : null}
            <ListItem
              icon={option.icon}
              title={t(`transactions.types.${option.type}`)}
              subtitle={t(option.hint)}
              onPress={() => open(option.type)}
            />
          </View>
        ))}
      </Card>
      <Button label={t('common.close')} variant="secondary" onPress={() => router.back()} />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: { padding: t.spacing.lg, gap: t.spacing.md },
}));
