import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, TextInput, View } from 'react-native';

import { makeStyles, useTheme } from '@/theme';

import { BottomSheet } from './BottomSheet';
import { Icon } from './Icon';
import { Text } from './Text';

export interface PickerOption<V extends string> {
  value: V;
  label: string;
  /** Secondary line, e.g. currency name or UTC offset. */
  description?: string;
  /** Leading content, e.g. a currency symbol. */
  leading?: ReactNode;
  /** Extra text matched by search but not shown. */
  keywords?: string;
  /** Shown but not selectable (the description should say why). */
  disabled?: boolean;
}

export interface OptionPickerProps<V extends string> {
  label: string;
  value: V | null;
  options: readonly PickerOption<V>[];
  onChange: (value: V) => void;
  placeholder?: string;
  hint?: string;
  searchable?: boolean;
  disabled?: boolean;
  /** Text shown in the field (defaults to the selected option's label). */
  displayValue?: string;
  /**
   * 'chip': a compact pill without the visible label (label still names it);
   * 'row': label left, value right, for a FormGroup.
   */
  variant?: 'field' | 'chip' | 'row';
}

/**
 * A form field that opens a bottom sheet to choose one option. Searchable for
 * long lists (currencies, regions, time zones). Accessible: the field is a
 * button announcing its current value; options are radio items.
 */
export function OptionPicker<V extends string>({
  label,
  value,
  options,
  onChange,
  placeholder,
  hint,
  searchable = false,
  disabled = false,
  displayValue,
  variant = 'field',
}: OptionPickerProps<V>) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = options.find((o) => o.value === value) ?? null;
  const shown = displayValue ?? selected?.label ?? placeholder ?? '';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      `${o.label} ${o.description ?? ''} ${o.keywords ?? ''} ${o.value}`.toLowerCase().includes(q),
    );
  }, [options, query]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  return (
    <View style={variant === 'field' ? styles.container : styles.chipContainer}>
      {variant === 'field' ? (
        <Text variant="label" tone="textSecondary">
          {label}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${shown}`}
        accessibilityHint={hint}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          variant === 'chip' ? styles.chip : variant === 'row' ? styles.row : styles.field,
          {
            backgroundColor: disabled
              ? theme.colors.surfaceMuted
              : pressed
                ? theme.colors.surfaceMuted
                : theme.colors.surface,
          },
        ]}
      >
        {variant === 'row' ? (
          <Text variant="label" tone="textSecondary" style={styles.rowLabel}>
            {label}
          </Text>
        ) : null}
        {selected?.leading ? <View style={styles.leading}>{selected.leading}</View> : null}
        <Text
          variant={variant === 'chip' ? 'label' : 'body'}
          tone={selected || displayValue ? 'text' : 'textMuted'}
          numberOfLines={1}
          style={
            variant === 'chip'
              ? styles.chipValue
              : variant === 'row'
                ? styles.rowValue
                : styles.value
          }
        >
          {shown}
        </Text>
        {disabled ? (
          <Icon name="lock-closed-outline" size={18} tone="textMuted" />
        ) : (
          <Icon name="chevron-down" size={18} tone="textSecondary" />
        )}
      </Pressable>
      {hint && variant === 'field' ? (
        <Text variant="bodySmall" tone="textMuted">
          {hint}
        </Text>
      ) : null}

      <BottomSheet visible={open} onClose={close} title={label} closeLabel={t('common.close')}>
        {searchable ? (
          <View style={styles.searchBox}>
            <Icon name="search" size={18} tone="textMuted" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('common.search')}
              placeholderTextColor={theme.colors.textMuted}
              accessibilityLabel={t('common.search')}
              autoCorrect={false}
              autoCapitalize="none"
              style={[styles.searchInput, { color: theme.colors.text }]}
            />
          </View>
        ) : null}
        <FlatList
          data={filtered}
          keyExtractor={(o) => o.value}
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={20}
          ListEmptyComponent={
            <Text variant="bodySmall" tone="textSecondary" style={styles.empty}>
              {t('common.noResults', { query })}
            </Text>
          }
          renderItem={({ item }) => {
            const isSelected = item.value === value;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{
                  selected: isSelected,
                  checked: isSelected,
                  disabled: !!item.disabled,
                }}
                disabled={item.disabled}
                accessibilityLabel={
                  item.description ? `${item.label}, ${item.description}` : item.label
                }
                onPress={() => {
                  onChange(item.value);
                  close();
                }}
                style={({ pressed }) => [
                  styles.option,
                  (pressed || isSelected) && { backgroundColor: theme.colors.surfaceMuted },
                  item.disabled && { opacity: 0.55 },
                ]}
              >
                {item.leading ? <View style={styles.leading}>{item.leading}</View> : null}
                <View style={styles.optionBody}>
                  <Text variant="body">{item.label}</Text>
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
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
    paddingHorizontal: t.spacing.md,
  },
  value: { flex: 1 },
  chipContainer: { flexShrink: 1 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
    minHeight: t.minTouchTarget,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    borderColor: t.colors.border,
    paddingStart: t.spacing.sm,
    paddingEnd: t.spacing.md,
  },
  chipValue: { flexShrink: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    minHeight: 52,
    paddingHorizontal: t.spacing.lg,
  },
  rowLabel: { flex: 1 },
  rowValue: { flexShrink: 1, textAlign: 'right' },
  leading: { minWidth: 28, alignItems: 'center' },
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
  list: { maxHeight: 420, flexShrink: 1 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
    minHeight: 56,
    paddingHorizontal: t.spacing.sm,
    borderRadius: t.radius.md,
  },
  optionBody: { flex: 1, paddingVertical: t.spacing.sm },
  empty: { padding: t.spacing.lg, textAlign: 'center' },
}));
