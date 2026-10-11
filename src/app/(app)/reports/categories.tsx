import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Card, Divider, ErrorState, Icon, LoadingState, Screen, Text } from '@/components/ui';
import { useCategoryName } from '@/features/categories/hooks';
import { ExcludedNote, useRangeLabel } from '@/features/reports/components/ReportParts';
import { ReportRow } from '@/features/reports/components/ReportRow';
import { openDrillDown } from '@/features/reports/drilldown';
import { useCategoryReport } from '@/features/reports/hooks';
import { useReportPeriod } from '@/features/reports/periodStore';
import { useFormatter } from '@/i18n/FormatContext';
import { makeStyles } from '@/theme';

/** All categories for the selected period, with subcategories and the previous period. */
export default function CategoryReportScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const categoryName = useCategoryName();
  const rangeLabel = useRangeLabel();
  const period = useReportPeriod();
  const query = useCategoryReport(period);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const base = formatter.settings.baseCurrency;
  const fmt = (amountMinor: number) => formatter.money({ amountMinor, currency: base });

  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <LoadingState />;
  const { current, previous, categoriesById } = query.data;
  const comparable = current.complete && previous.complete;
  const previousOf = (id: string | null) =>
    previous.items.find((i) => i.categoryId === id)?.spendingMinor ?? 0;
  const nameOf = (id: string | null) => {
    const c = id ? categoriesById.get(id) : undefined;
    return c ? categoryName(c) : t('reports.categories.uncategorized');
  };

  return (
    <Screen>
      <Text variant="bodySmall" tone="textSecondary">
        {rangeLabel(period.range)} · {fmt(current.totalMinor)}
      </Text>
      {current.items.length === 0 ? (
        <Card>
          <Text variant="body" tone="textSecondary">
            {t('reports.categories.empty')}
          </Text>
        </Card>
      ) : (
        <Card padding="none">
          {current.items.map((item, index) => {
            const key = item.categoryId ?? 'none';
            const open = expanded.has(key);
            const name = nameOf(item.categoryId);
            const shareText =
              item.shareBasisPoints !== null
                ? t('reports.categories.share', {
                    percent: formatter.percent(item.shareBasisPoints, 0),
                  })
                : null;
            const previousText = comparable
              ? t('reports.categories.previous', { amount: fmt(previousOf(item.categoryId)) })
              : null;
            return (
              <View key={key}>
                {index > 0 ? <Divider inset={16} /> : null}
                <ReportRow
                  title={name}
                  amount={fmt(item.spendingMinor)}
                  detail={[shareText, previousText].filter(Boolean).join(' · ') || null}
                  barBasisPoints={item.shareBasisPoints ?? 0}
                  onPress={() =>
                    openDrillDown({
                      kind: 'category',
                      title: name,
                      range: period.range,
                      categoryId: item.categoryId,
                      includeSubcategories: true,
                    })
                  }
                />
                {item.children.length > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: open }}
                    accessibilityLabel={`${open ? t('reports.categories.collapse') : t('reports.categories.expand')}: ${name}`}
                    onPress={() =>
                      setExpanded((set) => {
                        const next = new Set(set);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                    style={styles.toggle}
                  >
                    <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} tone="primary" />
                    <Text variant="bodySmall" tone="primary">
                      {open ? t('reports.categories.collapse') : t('reports.categories.expand')}
                    </Text>
                  </Pressable>
                ) : null}
                {open
                  ? item.children.map((child) => {
                      const childName =
                        child.categoryId === item.categoryId
                          ? t('reports.categories.itself', { name })
                          : nameOf(child.categoryId);
                      return (
                        <View key={child.categoryId} style={styles.child}>
                          <ReportRow
                            title={childName}
                            amount={fmt(child.spendingMinor)}
                            detail={
                              child.shareBasisPoints !== null
                                ? t('reports.categories.share', {
                                    percent: formatter.percent(child.shareBasisPoints, 0),
                                  })
                                : null
                            }
                            barBasisPoints={child.shareBasisPoints ?? 0}
                            onPress={() =>
                              openDrillDown({
                                kind: 'category',
                                title: childName,
                                range: period.range,
                                categoryId: child.categoryId,
                                includeSubcategories: false,
                              })
                            }
                          />
                        </View>
                      );
                    })
                  : null}
              </View>
            );
          })}
        </Card>
      )}
      <ExcludedNote excluded={current.excluded} />
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
    paddingHorizontal: t.spacing.lg,
    paddingBottom: t.spacing.sm,
    minHeight: t.minTouchTarget,
  },
  child: { paddingStart: t.spacing.lg },
}));
