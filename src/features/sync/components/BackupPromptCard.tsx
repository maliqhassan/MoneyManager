import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button, Card, Icon, Text } from '@/components/ui';
import { makeStyles } from '@/theme';

/**
 * Local-only use: explains that data is only on this device and offers to
 * sign in (existing account) or create one. Signing in merges this device's
 * data into the account and turns on sync.
 */
export function BackupPromptCard() {
  const { t } = useTranslation();
  const styles = useStyles();
  return (
    <Card>
      <View style={styles.body}>
        <View style={styles.header}>
          <View style={styles.icon}>
            <Icon name="cloud-upload-outline" size={22} tone="primary" />
          </View>
          <View style={styles.text}>
            <Text variant="bodyStrong">{t('localMode.title')}</Text>
            <Text variant="bodySmall" tone="textSecondary">
              {t('localMode.body')}
            </Text>
          </View>
        </View>
        <View style={styles.actions}>
          <View style={styles.action}>
            <Button
              label={t('localMode.signIn')}
              size="md"
              icon="log-in-outline"
              onPress={() => router.push('/sign-in')}
            />
          </View>
          <View style={styles.action}>
            <Button
              label={t('localMode.createAccount')}
              size="md"
              variant="secondary"
              onPress={() => router.push('/sign-up')}
            />
          </View>
        </View>
      </View>
    </Card>
  );
}

const useStyles = makeStyles((t) => ({
  body: { gap: t.spacing.md },
  header: { flexDirection: 'row', gap: t.spacing.md, alignItems: 'flex-start' },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: t.spacing.xxs },
  actions: { flexDirection: 'row', gap: t.spacing.sm, flexWrap: 'wrap' },
  action: { flexGrow: 1, flexBasis: 140 },
}));
