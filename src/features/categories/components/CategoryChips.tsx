import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import type { CategoryKind } from '@/domain/enums';
import type { Category } from '@/domain/models';
import { makeStyles, useTheme } from '@/theme';

import { useCategories, useCategoryName, useFrequentCategoryIds } from '../hooks';
import { CategoryIcon } from './CategoryIcon';
import { CategoryPickerSheet } from './CategoryPickerField';

/** Most chips shown before "All categories". */
const MAX_CHIPS = 10;

/**
 * One-tap category choice: the selected category, frequently used ones, then
 * top-level categories as a horizontal row of chips; "All" opens the full,
 * searchable grid with subcategories.
 */
export function CategoryChips({
  label,
  kind,
  value,
  onChange,
  error,
}: {
  label: string;
  kind: CategoryKind;
  value: string | null;
  onChange: (categoryId: string) => void;
  error?: string | null;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const name = useCategoryName();
  const [sheetOpen, setSheetOpen] = useState(false);
  const all = useCategories({ kind, includeArchived: true });
  const frequent = useFrequentCategoryIds(kind);

  const chips = useMemo(() => {
    const list = all.data ?? [];
    const byId = new Map(list.map((c) => [c.id, c]));
    const out: Category[] = [];
    const push = (c: Category | undefined) => {
      if (c && !out.some((x) => x.id === c.id) && out.length < MAX_CHIPS) out.push(c);
    };
    if (value) push(byId.get(value));
    for (const id of frequent.data ?? []) {
      const c = byId.get(id);
      if (c && !c.isArchived) push(c);
    }
    for (const c of list) if (!c.parentId && !c.isArchived) push(c);
    return out;
  }, [all.data, frequent.data, value]);

  return (
    <View style={styles.container}>
      <Text variant="label" tone="textSecondary" nativeID="category-chips-label">
        {label}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled"
        accessibilityLabelledBy="category-chips-label"
      >
        {chips.map((c) => {
          const selected = c.id === value;
          return (
            <Pressable
              key={c.id}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              accessibilityLabel={name(c)}
              onPress={() => onChange(c.id)}
              style={({ pressed }) => [
                styles.chip,
                selected && styles.chipSelected,
                pressed && !selected && { backgroundColor: theme.colors.surfaceMuted },
              ]}
            >
              <CategoryIcon icon={c.icon} color={c.color} size={28} />
              <Text
                variant="label"
                tone={selected ? 'primary' : 'text'}
                numberOfLines={1}
                style={styles.chipText}
              >
                {name(c)}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('categories.all')}
          onPress={() => setSheetOpen(true)}
          style={({ pressed }) => [
            styles.chip,
            styles.more,
            pressed && { backgroundColor: theme.colors.surfaceMuted },
          ]}
        >
          <Icon name="grid-outline" size={18} tone="primary" />
          <Text variant="label" tone="primary">
            {t('categories.allShort')}
          </Text>
        </Pressable>
      </ScrollView>
      {error ? (
        <Text variant="bodySmall" tone="negative" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <CategoryPickerSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={label}
        kind={kind}
        value={value}
        onChange={onChange}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: { gap: t.spacing.xs },
  row: { gap: t.spacing.sm, paddingVertical: t.spacing.xxs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    minHeight: t.minTouchTarget,
    paddingStart: t.spacing.xs + t.spacing.xxs,
    paddingEnd: t.spacing.md,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surface,
    maxWidth: 200,
  },
  chipSelected: {
    backgroundColor: t.colors.primaryMuted,
    borderColor: t.colors.primary,
    borderWidth: 2,
  },
  chipText: { flexShrink: 1 },
  more: { paddingStart: t.spacing.md },
}));
