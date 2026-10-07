import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Card, Divider, Screen, Text } from '@/components/ui';
import { makeStyles } from '@/theme';

export default function AboutScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const variant = String(Constants.expoConfig?.extra?.appVariant ?? 'development');

  return (
    <Screen>
      <View style={styles.hero}>
        <Text variant="title">{t('common.appName')}</Text>
        <Text variant="body" tone="textSecondary">
          {t('about.tagline')}
        </Text>
      </View>
      <Card padding="none">
        <View style={styles.row}>
          <Text variant="bodySmall" tone="textSecondary">
            {t('about.version')}
          </Text>
          <Text variant="body">{Constants.expoConfig?.version ?? '—'}</Text>
        </View>
        <Divider inset={16} />
        <View style={styles.row}>
          <Text variant="bodySmall" tone="textSecondary">
            {t('about.build')}
          </Text>
          <Text variant="body">{variant}</Text>
        </View>
      </Card>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  hero: { gap: t.spacing.xs, alignItems: 'center', paddingVertical: t.spacing.xl },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: t.spacing.lg,
  },
}));
