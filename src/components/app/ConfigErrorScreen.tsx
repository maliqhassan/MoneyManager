import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { makeStyles } from '@/theme';

import { Card, EmptyState, Screen, Text } from '../ui';

/**
 * Shown when required environment variables are missing or invalid. Issue
 * details (variable names only, never values) are listed in development.
 */
export function ConfigErrorScreen({ issues }: { issues: string[] }) {
  const { t } = useTranslation();
  const styles = useStyles();
  return (
    <Screen edges={['top', 'bottom']}>
      <EmptyState
        icon="construct-outline"
        title={t('config.title')}
        description={t('config.body')}
      />
      {__DEV__ ? (
        <Card>
          <View style={styles.list}>
            {issues.map((issue) => (
              <Text key={issue} variant="bodySmall" tone="textSecondary">
                • {issue}
              </Text>
            ))}
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  list: { gap: t.spacing.xs },
}));
