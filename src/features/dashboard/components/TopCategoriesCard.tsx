import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Card, MoneyText, ProgressBar, Text } from '@/components/ui';
import type { Category } from '@/domain/models';
import type { CategorySpend } from '@/domain/transactions/insights';
import { CategoryIcon } from '@/features/categories/components/CategoryIcon';
import { useCategoryName } from '@/features/categories/hooks';
import { makeStyles } from '@/theme';

/** Top spending categories (subcategories rolled up), bars relative to the largest. */
export function TopCategoriesCard({
  items,
  categoriesById,
}: {
  items: readonly CategorySpend[];
  categoriesById: ReadonlyMap<string, Category>;
}) {
  const { t } = useTranslation();
  const styles = useStyles();
  const name = useCategoryName();
  const max = items[0]?.spent.amountMinor ?? 0;

  return (
    <Card>
      <View style={styles.body}>
        {items.length === 0 ? (
          <Text variant="bodySmall" tone="textSecondary">
            {t('home.noSpending')}
          </Text>
        ) : (
          items.map((item) => {
            const category = item.categoryId ? categoriesById.get(item.categoryId) : undefined;
            const label = name(category, t('transactions.uncategorized'));
            // Relative bar width (display only): integer basis points of the largest.
            const bp = max > 0 ? Math.round((item.spent.amountMinor * 10_000) / max) : 0;
            return (
              <View key={item.categoryId ?? 'none'} style={styles.item}>
                <View style={styles.row}>
                  <CategoryIcon icon={category?.icon} color={category?.color} size={28} />
                  <Text variant="body" style={styles.flex} numberOfLines={1}>
                    {label}
                  </Text>
                  <MoneyText value={item.spent} />
                </View>
                <ProgressBar valueBasisPoints={bp} accessibilityLabel={label} height={6} />
              </View>
            );
          })
        )}
      </View>
    </Card>
  );
}

const useStyles = makeStyles((t) => ({
  body: { gap: t.spacing.md },
  item: { gap: t.spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
  flex: { flex: 1 },
}));
