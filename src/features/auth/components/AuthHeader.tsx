import { View } from 'react-native';

import { Text } from '@/components/ui';
import { makeStyles } from '@/theme';

export function AuthHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.header}>
      <Text variant="title">{title}</Text>
      {subtitle ? (
        <Text variant="body" tone="textSecondary">
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  header: { gap: t.spacing.sm, marginBottom: t.spacing.sm },
}));
