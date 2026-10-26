import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';

import { Badge, Button, Card, Screen, Text } from '@/components/ui';
import { FormError } from '@/features/auth/components/FormError';
import { useSignOut } from '@/features/auth/hooks/useSignOut';
import { useData } from '@/providers/DataProvider';
import { makeStyles } from '@/theme';

export default function PrivacyScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const { requestDeleteAccount, eraseLocalData, busy } = useSignOut();
  const { mode } = useData();
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

  const confirmErase = () =>
    Alert.alert(t('privacy.eraseTitle'), t('privacy.eraseConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('privacy.erase'),
        style: 'destructive',
        onPress: () => void eraseLocalData().catch(setDeleteError),
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
          <Text variant="heading">
            {mode === 'local' ? t('privacy.eraseTitle') : t('privacy.deleteTitle')}
          </Text>
          <Text variant="body" tone="textSecondary">
            {mode === 'local' ? t('privacy.eraseBody') : t('privacy.deleteBody')}
          </Text>
          <Button
            label={mode === 'local' ? t('privacy.erase') : t('more.deleteAccount')}
            variant="destructive"
            icon="trash-outline"
            loading={busy}
            onPress={mode === 'local' ? confirmErase : confirmDelete}
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
