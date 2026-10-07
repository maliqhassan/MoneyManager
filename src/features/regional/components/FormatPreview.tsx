import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Card, Text } from '@/components/ui';
import type { Formatter } from '@/i18n/formatter';
import { makeStyles } from '@/theme';

const SAMPLE_DATE = '2026-01-31';

/** Live preview of how amounts and dates will look with the given settings. */
export function FormatPreview({ formatter }: { formatter: Formatter }) {
  const { t } = useTranslation();
  const styles = useStyles();
  const amount = formatter.money({
    amountMinor: 123456,
    currency: formatter.settings.baseCurrency,
  });
  const date = formatter.date(SAMPLE_DATE);
  const longDate = formatter.date(SAMPLE_DATE, 'medium');
  return (
    <Card>
      <View
        style={styles.body}
        accessible
        accessibilityLabel={`${t('regional.preview')}: ${amount}, ${date}`}
      >
        <Text variant="label" tone="textSecondary">
          {t('regional.preview')}
        </Text>
        <Text variant="amount">{amount}</Text>
        <Text variant="body">{`${date} · ${longDate}`}</Text>
      </View>
    </Card>
  );
}

const useStyles = makeStyles((t) => ({
  body: { gap: t.spacing.xs },
}));
