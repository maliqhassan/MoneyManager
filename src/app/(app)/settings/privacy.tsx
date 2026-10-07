import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';

import { Badge, Button, Card, Screen, Text } from '@/components/ui';
import { FormError } from '@/features/auth/components/FormError';
import { useSignOut } from '@/features/auth/hooks/useSignOut';
import { makeStyles } from '@/theme';

export default function PrivacyScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const { requestDeleteAccount, busy } = useSignOut();
  const [deleteError, setDeleteError] = useState<unknown>(null);

  const confirmDelete = () =>
    Alert.alert(t('more.deleteAccount'), t('more.deleteAccountConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('more.deleteAccount'),
        style: 'destructive',
        onPress: () => void requestDeleteAccount(setDeleteError),
      },
    ]);

  return (
    <Screen>
      <Card>
        <View style={styles.block}>
          <Text variant="heading">{t('privacy.storageTitle')}</Text>
          <Text variant="body" tone="textSecondary">
            {t('privacy.storageBody')}
          </Text>
        </View>
      </Card>
      <Card>
        <View style={styles.block}>
          <Text variant="heading">{t('privacy.securityTitle')}</Text>
          <Text variant="body" tone="textSecondary">
            {t('privacy.securityBody')}
          </Text>
        </View>
      </Card>
      <Card>
        <View style={styles.block}>
          <View style={styles.titleRow}>
            <Text variant="heading">{t('privacy.exportTitle')}</Text>
            <Badge label={t('common.notAvailableYet')} />
          </View>
          <Text variant="body" tone="textSecondary">
            {t('privacy.exportBody')}
          </Text>
        </View>
      </Card>
      <Card>
        <View style={styles.block}>
          <Text variant="heading">{t('privacy.deleteTitle')}</Text>
          <Text variant="body" tone="textSecondary">
            {t('privacy.deleteBody')}
          </Text>
          <Button
            label={t('more.deleteAccount')}
            variant="destructive"
            icon="trash-outline"
            loading={busy}
            onPress={confirmDelete}
          />
          <FormError error={deleteError} />
        </View>
      </Card>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  block: { gap: t.spacing.sm },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing.sm,
  },
}));
