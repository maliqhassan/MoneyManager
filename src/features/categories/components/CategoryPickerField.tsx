import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, TextInput, View } from 'react-native';

import { BottomSheet, Icon, Text } from '@/components/ui';
import type { CategoryKind } from '@/domain/enums';
import type { Category } from '@/domain/models';
import { normalizeSearchText } from '@/domain/text/search';
import { makeStyles, useTheme } from '@/theme';

import { useCategories, useCategoryName, useFrequentCategoryIds } from '../hooks';
import { CategoryIcon } from './CategoryIcon';

type Row =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'category'; key: string; category: Category; indent: boolean; description?: string };

export interface CategoryPickerFieldProps {
  label: string;
  kind: CategoryKind;
  value: string | null;
  onChange: (categoryId: string) => void;
  error?: string | null;
  /** Placeholder when nothing is selected. */
  placeholder?: string;
}

/**
 * Grouped, searchable category picker. Archived categories are excluded from
 * new choices, but the currently selected one (historical) stays visible.
 */
export function CategoryPickerField({
  label,
  kind,
  value,
  onChange,
  error,
  placeholder,
}: CategoryPickerFieldProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const name = useCategoryName();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const all = useCategories({ kind, includeArchived: true });
  const frequent = useFrequentCategoryIds(kind);

  const categories = useMemo(() => all.data ?? [], [all.data]);
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const selected = value ? byId.get(value) : undefined;
  const selectable = useMemo(
    () => categories.filter((c) => !c.isArchived || c.id === value),
    [categories, value],
  );

  const rows = useMemo<Row[]>(() => {
    const q = normalizeSearchText(query);
    if (q) {
      return selectable
        .filter((c) => normalizeSearchText(name(c)).includes(q))
        .map((c) => ({
          kind: 'category' as const,
          key: c.id,
          category: c,
          indent: false,
          ...(c.parentId ? { description: name(byId.get(c.parentId)) } : {}),
        }));
    }
    const result: Row[] = [];
    const recent = (frequent.data ?? [])
      .map((id) => byId.get(id))
      .filter((c): c is Category => !!c && !c.isArchived);
    if (recent.length > 0) {
      result.push({ kind: 'header', key: 'h-recent', title: t('categories.recent') });
      for (const c of recent)
        result.push({ kind: 'category', key: `r-${c.id}`, category: c, indent: false });
      result.push({ kind: 'header', key: 'h-all', title: t('categories.all') });
    }
    for (const parent of selectable.filter((c) => !c.parentId)) {
      result.push({ kind: 'category', key: parent.id, category: parent, indent: false });
      for (const child of selectable.filter((c) => c.parentId === parent.id)) {
        result.push({ kind: 'category', key: child.id, category: child, indent: true });
      }
    }
    return result;
  }, [query, selectable, frequent.data, byId, name, t]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

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
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.field,
          {
            borderColor: error ? theme.colors.negative : theme.colors.borderStrong,
            borderWidth: error ? 2 : 1,
            backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
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

      <BottomSheet visible={open} onClose={close} title={label} closeLabel={t('common.close')}>
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
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text variant="bodySmall" tone="textSecondary" style={styles.empty}>
              {query ? t('common.noResults', { query }) : t('categories.emptyBody')}
            </Text>
          }
          renderItem={({ item }) => {
            if (item.kind === 'header') {
              return (
                <Text
                  variant="label"
                  tone="textSecondary"
                  style={styles.header}
                  accessibilityRole="header"
                >
                  {item.title}
                </Text>
              );
            }
            const c = item.category;
            const isSelected = c.id === value;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected, checked: isSelected }}
                accessibilityLabel={item.description ? `${name(c)}, ${item.description}` : name(c)}
                onPress={() => {
                  onChange(c.id);
                  close();
                }}
                style={({ pressed }) => [
                  styles.option,
                  item.indent && styles.indent,
                  (pressed || isSelected) && { backgroundColor: theme.colors.surfaceMuted },
                ]}
              >
                <CategoryIcon icon={c.icon} color={c.color} size={item.indent ? 28 : 32} />
                <View style={styles.optionBody}>
                  <Text variant={item.indent ? 'body' : 'bodyStrong'}>{name(c)}</Text>
                  {item.description ? (
                    <Text variant="bodySmall" tone="textSecondary">
                      {item.description}
                    </Text>
                  ) : null}
                </View>
                {isSelected ? <Icon name="checkmark" tone="primary" /> : null}
              </Pressable>
            );
          }}
        />
      </BottomSheet>
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
  list: { maxHeight: 460 },
  header: {
    paddingTop: t.spacing.md,
    paddingBottom: t.spacing.xs,
    paddingHorizontal: t.spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
    minHeight: t.minTouchTarget + 4,
    paddingHorizontal: t.spacing.sm,
    borderRadius: t.radius.md,
  },
  indent: { paddingStart: t.spacing.xl + t.spacing.md },
  optionBody: { flex: 1, paddingVertical: t.spacing.xs },
  empty: { padding: t.spacing.lg, textAlign: 'center' },
}));
