import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import type { CategoryKind } from '@/domain/enums';
import type { Category } from '@/domain/models';
import { MAX_FONT_SCALE_DENSE, makeStyles } from '@/theme';

import { useCategories, useCategoryName, useFrequentCategoryIds } from '../hooks';
import { resolveCategoryColor, resolveCategoryIcon } from './CategoryIcon';
import { CategoryPickerSheet } from './CategoryPickerField';

/** Categories placed around the dial. */
const SLOTS = 6;
const SIZE = 264;
const BUBBLE = 52;
const RADIUS = (SIZE - BUBBLE) / 2;

/**
 * The amount in the middle, the most likely categories around it: the
 * selected one, then frequently used, then top-level categories. "All
 * categories" opens the full searchable grid. Each bubble is a radio button
 * with the category's full name.
 */
export function CategoryDial({
  kind,
  value,
  onChange,
  center,
  label,
}: {
  kind: CategoryKind;
  value: string | null;
  onChange: (categoryId: string) => void;
  /** The amount (and caption) shown in the middle. */
  center: ReactNode;
  label: string;
}) {
  const { t } = useTranslation();
  const styles = useStyles();
  const name = useCategoryName();
  const [sheetOpen, setSheetOpen] = useState(false);
  const all = useCategories({ kind, includeArchived: true });
  const frequent = useFrequentCategoryIds(kind);

  const slots = useMemo(() => {
    const list = all.data ?? [];
    const byId = new Map(list.map((c) => [c.id, c]));
    const out: Category[] = [];
    const push = (c: Category | undefined) => {
      if (c && !c.isArchived && !out.some((x) => x.id === c.id) && out.length < SLOTS) out.push(c);
    };
    for (const id of frequent.data ?? []) push(byId.get(id));
    for (const c of list) if (!c.parentId) push(c);
    // The selected category always has a place (it replaces the last one).
    const selected = value ? byId.get(value) : undefined;
    if (selected && !out.some((c) => c.id === selected.id)) {
      if (out.length >= SLOTS) out.pop();
      out.push(selected);
    }
    return out;
  }, [all.data, frequent.data, value]);

  return (
    <View style={styles.wrap}>
      <View style={styles.dial} accessibilityRole="radiogroup" accessibilityLabel={label}>
        <View style={styles.ring} pointerEvents="none" />
        <View style={styles.center}>{center}</View>
        {slots.map((c, i) => {
          const angle = -Math.PI / 2 + (i * 2 * Math.PI) / SLOTS;
          const selected = c.id === value;
          const color = resolveCategoryColor(c.color);
          return (
            <Pressable
              key={c.id}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              accessibilityLabel={name(c)}
              onPress={() => onChange(c.id)}
              style={[
                styles.bubble,
                {
                  left: SIZE / 2 + RADIUS * Math.cos(angle) - BUBBLE / 2,
                  top: SIZE / 2 + RADIUS * Math.sin(angle) - BUBBLE / 2,
                },
                selected && styles.bubbleSelected,
              ]}
            >
              <Icon
                name={resolveCategoryIcon(c.icon)}
                size={18}
                // Category colours are user data; the glyph colour comes from the theme.
                tone={selected ? 'onPrimary' : 'textSecondary'}
              />
              <Text
                variant="caption"
                tone={selected ? 'onPrimary' : 'textSecondary'}
                numberOfLines={1}
                maxFontSizeMultiplier={1.2}
                style={styles.abbr}
              >
                {abbreviate(name(c))}
              </Text>
              {!selected ? (
                <View style={[styles.dot, { backgroundColor: color }]} pointerEvents="none" />
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => setSheetOpen(true)}
        style={styles.allButton}
      >
        <Icon name="grid-outline" size={16} tone="primary" />
        <Text variant="label" tone="primary" maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
          {t('categories.all')}
        </Text>
      </Pressable>
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

/** "Dining out" → "DIN" (shown under the icon; the full name is the label). */
export function abbreviate(name: string): string {
  // Letters (any script with case) and digits; spaces and punctuation are skipped.
  const letters = [...name].filter(
    (c) => /[A-Za-z0-9]/.test(c) || c.toLowerCase() !== c.toUpperCase(),
  );
  return letters.slice(0, 3).join('').toUpperCase();
}

const useStyles = makeStyles((t) => ({
  wrap: { alignItems: 'center', gap: t.spacing.xs },
  dial: { width: SIZE, height: SIZE },
  ring: {
    position: 'absolute',
    left: BUBBLE / 2,
    top: BUBBLE / 2,
    width: SIZE - BUBBLE,
    height: SIZE - BUBBLE,
    borderRadius: (SIZE - BUBBLE) / 2,
    borderWidth: 1,
    borderColor: t.colors.border,
    borderStyle: 'dashed',
  },
  center: {
    position: 'absolute',
    left: SIZE / 2 - 78,
    top: SIZE / 2 - 78,
    width: 156,
    height: 156,
    borderRadius: 78,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: t.spacing.md,
    ...t.elevation.low,
  },
  bubble: {
    position: 'absolute',
    width: BUBBLE,
    height: BUBBLE,
    borderRadius: BUBBLE / 2,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...t.elevation.low,
  },
  bubbleSelected: { backgroundColor: t.colors.primary, borderColor: t.colors.primary },
  abbr: { fontWeight: '700' },
  dot: { position: 'absolute', top: 4, right: 6, width: 8, height: 8, borderRadius: 4 },
  allButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
    minHeight: t.minTouchTarget,
    paddingHorizontal: t.spacing.md,
  },
}));
