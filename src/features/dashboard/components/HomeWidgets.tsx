import { type Href, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { Icon, type IconName, MoneyText, ProgressRing, SectionHeader, Text } from '@/components/ui';
import type { Category } from '@/domain/models';
import type { Money } from '@/domain/money/money';
import type { CategorySpend } from '@/domain/transactions/insights';
import { useBudgetOverviews } from '@/features/budgets/hooks';
import { CategoryIcon } from '@/features/categories/components/CategoryIcon';
import { useCategoryName } from '@/features/categories/hooks';
import { useGoals } from '@/features/goals/hooks';
import { makeStyles, useTheme } from '@/theme';

/** Two summary tiles: e.g. spent and income this month. */
export function SummaryTiles({
  tiles,
}: {
  tiles: { key: string; icon: IconName; label: string; value: Money | null; note?: string }[];
}) {
  const styles = useStyles();
  return (
    <View style={styles.tiles}>
      {tiles.map((tile) => (
        <View key={tile.key} style={styles.tile} accessible>
          <View style={styles.tileIcon}>
            <Icon name={tile.icon} size={20} tone="primary" />
          </View>
          <View style={styles.tileText}>
            <Text variant="caption" tone="textSecondary" numberOfLines={1}>
              {tile.label}
            </Text>
            {tile.value ? (
              <MoneyText
                value={tile.value}
                variant="bodyStrong"
                numberOfLines={1}
                adjustsFontSizeToFit
              />
            ) : (
              <Text variant="bodySmall" tone="textSecondary" numberOfLines={2}>
                {tile.note ?? '—'}
              </Text>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

/** This month's top categories as a row of cards (subcategories rolled up). */
export function CategorySpendStrip({
  items,
  categoriesById,
}: {
  items: readonly CategorySpend[];
  categoriesById: ReadonlyMap<string, Category>;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const name = useCategoryName();
  if (items.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionHeader
        title={t('home.spendingByCategory')}
        actionLabel={t('common.seeAll')}
        onAction={() => router.navigate('/reports' as Href)}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
      >
        {items.map((item) => {
          const category = item.categoryId ? categoriesById.get(item.categoryId) : undefined;
          const label = name(category, t('transactions.uncategorized'));
          return (
            <Pressable
              key={item.categoryId ?? 'none'}
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => router.navigate('/reports' as Href)}
              style={({ pressed }) => [
                styles.catCard,
                pressed && { backgroundColor: theme.colors.surfaceMuted },
              ]}
            >
              <CategoryIcon icon={category?.icon} color={category?.color} size={36} />
              <View style={styles.catText}>
                <Text variant="caption" tone="textSecondary" numberOfLines={1}>
                  {label}
                </Text>
                <MoneyText value={item.spent} variant="bodyStrong" numberOfLines={1} />
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const RING_LIMIT = 5;

/**
 * Progress at a glance: a ring per budget (share used this period) and per
 * savings goal (share saved), each with its written percentage and name.
 */
export function PlanRings() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const budgets = useBudgetOverviews(false);
  const goals = useGoals('active');

  const rings = [
    ...(budgets.data ?? []).map((b) => ({
      key: `b-${b.budget.id}`,
      label: b.budget.name,
      bp: b.evaluation.current.usedBasisPoints,
      tone: (b.evaluation.current.usedBasisPoints > 10_000 ? 'negative' : 'primary') as
        'negative' | 'primary',
      href: `/budgets/${b.budget.id}` as Href,
      kind: t('home.budgetsTitle'),
    })),
    ...(goals.data ?? []).map((g) => ({
      key: `g-${g.goal.id}`,
      label: g.goal.name,
      bp: g.progress.progressBasisPoints,
      tone: 'positive' as const,
      href: `/goals/${g.goal.id}` as Href,
      kind: t('home.goalsTitle'),
    })),
  ].slice(0, RING_LIMIT);

  if (rings.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionHeader
        title={t('home.plansTitle')}
        actionLabel={t('common.seeAll')}
        onAction={() => router.navigate('/budgets' as Href)}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rings}
      >
        {rings.map((r) => {
          const percent = Math.round(r.bp / 100);
          return (
            <Pressable
              key={r.key}
              accessibilityRole="button"
              accessibilityLabel={`${r.kind}: ${r.label}, ${percent}%`}
              onPress={() => router.push(r.href)}
              style={({ pressed }) => [styles.ringItem, pressed && { opacity: 0.7 }]}
            >
              <ProgressRing basisPoints={r.bp} size={64} stroke={6} tone={r.tone}>
                <Text variant="label" style={{ color: theme.colors[r.tone] }}>
                  {`${percent}%`}
                </Text>
              </ProgressRing>
              <Text
                variant="caption"
                tone="textSecondary"
                numberOfLines={1}
                style={styles.ringLabel}
              >
                {r.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  section: { gap: t.spacing.md },
  tiles: { flexDirection: 'row', gap: t.spacing.sm },
  tile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    padding: t.spacing.md,
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileText: { flex: 1, gap: t.spacing.xxs },
  strip: { gap: t.spacing.sm, paddingEnd: t.spacing.lg },
  catCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    minWidth: 150,
    maxWidth: 220,
    padding: t.spacing.md,
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  catText: { flexShrink: 1, gap: t.spacing.xxs },
  rings: { gap: t.spacing.lg, paddingEnd: t.spacing.lg, paddingVertical: t.spacing.xs },
  ringItem: { alignItems: 'center', gap: t.spacing.xs, width: 76 },
  ringLabel: { maxWidth: 76 },
}));
