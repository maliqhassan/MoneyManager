import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { errorMessageKey } from '@/lib/errors';
import { makeStyles } from '@/theme';

/** Form-level error (e.g. wrong password), translated from the error code. */
export function FormError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const styles = useStyles();
  if (!error) return null;
  return (
    <View style={styles.box} accessibilityRole="alert" accessibilityLiveRegion="assertive">
      <Icon name="alert-circle-outline" size={18} tone="negative" />
      <Text variant="bodySmall" tone="negative" style={styles.text}>
        {t(errorMessageKey(error))}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  box: {
    flexDirection: 'row',
    gap: t.spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: t.colors.negativeMuted,
    borderRadius: t.radius.md,
    padding: t.spacing.md,
  },
  text: { flex: 1 },
}));
