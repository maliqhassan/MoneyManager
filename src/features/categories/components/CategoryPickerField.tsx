import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { BottomSheet, Icon, Text } from '@/components/ui';
import type { CategoryKind } from '@/domain/enums';
import type { Category } from '@/domain/models';
import { normalizeSearchText } from '@/domain/text/search';
import { makeStyles, useTheme } from '@/theme';

import { useCategories, useCategoryName, useFrequentCategoryIds } from '../hooks';
import { CategoryIcon } from './CategoryIcon';

interface Section {
  key: string;
  title: string;
  categories: Category[];
}

export interface CategoryPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  kind: CategoryKind;
  value: string | null;
  onChange: (categoryId: string) => void;
}

/**
 * Searchable grid of categories: frequently used first, then each parent
 * with its subcategories. Archived categories are not offered, except the
 * currently selected one (historical entries keep showing it).
 */
export function CategoryPickerSheet({
  visible,
  onClose,
  title,
  kind,
  value,
  onChange,
}: CategoryPickerSheetProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const name = useCategoryName();
  const [query, setQuery] = useState('');
  const all = useCategories({ kind, includeArchived: true });
  const frequent = useFrequentCategoryIds(kind);

  const categories = useMemo(() => all.data ?? [], [all.data]);
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const selectable = useMemo(
    () => categories.filter((c) => !c.isArchived || c.id === value),
    [categories, value],
  );

  const sections = useMemo<Section[]>(() => {
    const q = normalizeSearchText(query);
    if (q) {
      return [
        {
          key: 'results',
          title: '',
          categories: selectable.filter((c) => normalizeSearchText(name(c)).includes(q)),
        },
      ];
    }
    const result: Section[] = [];
    const recent = (frequent.data ?? [])
      .map((id) => byId.get(id))
      .filter((c): c is Category => !!c && !c.isArchived);
    if (recent.length > 0) {
      result.push({ key: 'recent', title: t('categories.recent'), categories: recent });
    }
    for (const parent of selectable.filter((c) => !c.parentId)) {
      result.push({
        key: parent.id,
        title: name(parent),
        categories: [parent, ...selectable.filter((c) => c.parentId === parent.id)],
      });
    }
    return result;
  }, [query, selectable, frequent.data, byId, name, t]);

  const close = () => {
    onClose();
    setQuery('');
  };
  const empty = sections.every((s) => s.categories.length === 0);

  return (
    <BottomSheet visible={visible} onClose={close} title={title} closeLabel={t('common.close')}>
      <View style={styles.searchBox}>
        <Icon name="search" size={18} tone="textMuted" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('categories.search')}
          placeholderTextColor={theme.colors.textMuted}
          accessibilityLabel={t('categories.search')}
          autoCorrect={false}
          style={[styles.searchInput, { color: theme.colors.text }]}
        />
      </View>
      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {empty ? (
          <Text variant="bodySmall" tone="textSecondary" style={styles.empty}>
            {query ? t('common.noResults', { query }) : t('categories.emptyBody')}
          </Text>
        ) : null}
        {sections.map((section) =>
          section.categories.length === 0 ? null : (
            <View key={section.key} style={styles.section}>
              {section.title ? (
                <Text variant="label" tone="textSecondary" accessibilityRole="header">
                  {section.title}
                </Text>
              ) : null}
              <View style={styles.grid}>
                {section.categories.map((c) => {
                  const isSelected = c.id === value;
                  // In search results the parent says which group a subcategory is in.
                  const parent =
                    section.key === 'results' && c.parentId ? byId.get(c.parentId) : undefined;
                  return (
                    <Pressable
                      key={`${section.key}-${c.id}`}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isSelected, checked: isSelected }}
                      accessibilityLabel={parent ? `${name(c)}, ${name(parent)}` : name(c)}
                      onPress={() => {
                        onChange(c.id);
                        close();
                      }}
                      style={({ pressed }) => [
                        styles.tile,
                        (pressed || isSelected) && { backgroundColor: theme.colors.surfaceMuted },
                        isSelected && { borderColor: theme.colors.primary },
                      ]}
                    >
                      <CategoryIcon icon={c.icon} color={c.color} size={40} />
                      <Text variant="caption" align="center" numberOfLines={2}>
                        {name(c)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ),
        )}
      </ScrollView>
    </BottomSheet>
  );
}

export interface CategoryPickerFieldProps {
  label: string;
  kind: CategoryKind;
  value: string | null;
  onChange: (categoryId: string) => void;
  error?: string | null;
  /** Placeholder when nothing is selected. */
  placeholder?: string;
  /** Read-only (e.g. a budget whose periods have completed). */
  disabled?: boolean;
}

/** Form field showing the chosen category; opens the category grid. */
export function CategoryPickerField({
  label,
  kind,
  value,
  onChange,
  error,
  placeholder,
  disabled = false,
}: CategoryPickerFieldProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const name = useCategoryName();
  const [open, setOpen] = useState(false);
  const all = useCategories({ kind, includeArchived: true });
  const selected = value ? all.data?.find((c) => c.id === value) : undefined;

  const shown = selected
    ? selected.isArchived
      ? t('transactions.detail.archivedCategory', { name: name(selected) })
      : name(selected)
    : (placeholder ?? t('transactions.fields.chooseCategory'));

  return (
    <View style={styles.container}>
      <Text variant="label" tone="textSecondary">
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${shown}`}
        accessibilityHint={error ?? undefined}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.field,
          {
            borderColor: error ? theme.colors.negative : theme.colors.borderStrong,
            borderWidth: error ? 2 : 1,
            backgroundColor: pressed || disabled ? theme.colors.surfaceMuted : theme.colors.surface,
          },
        ]}
      >
        {selected ? <CategoryIcon icon={selected.icon} color={selected.color} size={28} /> : null}
        <Text
          variant="body"
          tone={selected ? 'text' : 'textMuted'}
          numberOfLines={1}
          style={styles.value}
        >
          {shown}
        </Text>
        <Icon name="chevron-down" size={18} tone="textSecondary" />
      </Pressable>
      {error ? (
        <Text variant="bodySmall" tone="negative" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <CategoryPickerSheet
        visible={open}
        onClose={() => setOpen(false)}
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
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    minHeight: 52,
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.md,
  },
  value: { flex: 1 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surfaceMuted,
    paddingHorizontal: t.spacing.md,
    minHeight: t.minTouchTarget,
  },
  searchInput: { flex: 1, ...t.typography.body, paddingVertical: t.spacing.sm },
  list: { maxHeight: 480, flexShrink: 1 },
  section: { gap: t.spacing.sm, paddingVertical: t.spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.xs },
  tile: {
    width: '23.5%',
    minHeight: 84,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: t.spacing.xs,
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.xxs,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  empty: { padding: t.spacing.lg, textAlign: 'center' },
}));
