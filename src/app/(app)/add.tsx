import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge, Button, Card, Divider, ListItem, Text } from '@/components/ui';
import { makeStyles } from '@/theme';

/**
 * Global Add sheet (opened from the centre tab button). The three entry
 * points are wired here; their forms ship with the Transactions phase, so the
 * options are shown as disabled with a "Coming soon" badge rather than
 * pretending to work.
 */
export default function AddSheet() {
  const { t } = useTranslation();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const soon = <Badge label={t('common.comingSoon')} tone="neutral" />;

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 16 }]}>
      <Text variant="heading">{t('add.title')}</Text>
      <Card padding="none">
        <ListItem
          icon="arrow-up-circle-outline"
          title={t('add.expense')}
          subtitle={t('add.expenseHint')}
          trailing={soon}
        />
        <Divider inset={64} />
        <ListItem
          icon="arrow-down-circle-outline"
          title={t('add.income')}
          subtitle={t('add.incomeHint')}
          trailing={soon}
        />
        <Divider inset={64} />
        <ListItem
          icon="swap-horizontal-outline"
          title={t('add.transfer')}
          subtitle={t('add.transferHint')}
          trailing={soon}
        />
      </Card>
      <Text variant="bodySmall" tone="textSecondary">
        {t('add.notReadyBody')}
      </Text>
      <Button label={t('common.close')} variant="secondary" onPress={() => router.back()} />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: { padding: t.spacing.lg, gap: t.spacing.md },
}));
