import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';

import { TagChip, Text, useKeyboardAware } from '@/components/ui';
import { normalizeSearchText } from '@/domain/text/search';
import { useTags } from '@/features/categories/hooks';
import { makeStyles, useTheme } from '@/theme';

const MAX_TAGS = 20;
const MAX_SUGGESTIONS = 8;

/**
 * Tags as a token field: applied tags are chips inside the box, typing adds
 * more (Enter or a comma finishes one; several can be pasted at once). An
 * existing tag's spelling is reused (matched case-insensitively), so the same
 * tag is never created twice. Existing tags are offered below as one-tap
 * chips, filtered by what is being typed.
 */
export function TagInput({
  value,
  onChange,
  onFocus,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  onFocus?: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const keyboardAware = useKeyboardAware();
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const tags = useTags();
  const full = value.length >= MAX_TAGS;

  const has = (name: string) =>
    value.some((v) => normalizeSearchText(v) === normalizeSearchText(name));

  const canonical = (raw: string) => {
    const name = raw.replace(/^#+/, '').trim().slice(0, 50);
    if (!name) return null;
    // Reuse an existing tag's spelling when it matches.
    const existing = tags.data?.find(
      (tag) => normalizeSearchText(tag.name) === normalizeSearchText(name),
    );
    return existing?.name ?? name;
  };

  const addAll = (raws: string[]) => {
    const next = [...value];
    for (const raw of raws) {
      const name = canonical(raw);
      const dup = (n: string) =>
        next.some((v) => normalizeSearchText(v) === normalizeSearchText(n));
      if (name && !dup(name) && next.length < MAX_TAGS) next.push(name);
    }
    if (next.length !== value.length) onChange(next);
    setText('');
  };
  const add = (raw: string) => addAll([raw]);

  /** A comma finishes a tag (several can be pasted at once). */
  const onChangeText = (next: string) => {
    if (!next.includes(',')) {
      setText(next);
      return;
    }
    const parts = next.split(',');
    const rest = parts.pop() ?? '';
    addAll(parts);
    setText(rest);
  };

  const suggestions = useMemo(() => {
    const q = normalizeSearchText(text.replace(/^#+/, ''));
    return (tags.data ?? [])
      .filter((tag) => !has(tag.name) && (!q || normalizeSearchText(tag.name).includes(q)))
      .slice(0, MAX_SUGGESTIONS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tags.data, text, value]);

  return (
    <View style={styles.container}>
      <Text variant="label" tone="textSecondary" nativeID="tags-label">
        {t('transactions.fields.tags')}
      </Text>
      <View
        style={[
          styles.box,
          {
            borderColor: focused ? theme.colors.focusRing : theme.colors.borderStrong,
            borderWidth: focused ? 2 : 1,
          },
        ]}
      >
        {value.map((tag) => (
          <TagChip
            key={tag}
            name={tag}
            onRemove={() => onChange(value.filter((v) => v !== tag))}
            accessibilityLabel={t('transactions.fields.removeTag', { name: tag })}
          />
        ))}
        {!full ? (
          <TextInput
            value={text}
            onChangeText={onChangeText}
            placeholder={
              value.length === 0
                ? t('transactions.fields.tagPlaceholder')
                : t('transactions.fields.addTag')
            }
            placeholderTextColor={theme.colors.textMuted}
            accessibilityLabel={t('transactions.fields.tags')}
            accessibilityLabelledBy="tags-label"
            returnKeyType="done"
            blurOnSubmit={false}
            onSubmitEditing={() => add(text)}
            onFocus={() => {
              setFocused(true);
              keyboardAware?.revealFocusedInput();
              onFocus?.();
            }}
            onBlur={() => {
              setFocused(false);
              if (text.trim()) add(text);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={50}
            selectionColor={theme.colors.primary}
            style={[styles.input, { color: theme.colors.text }]}
          />
        ) : null}
      </View>
      {full ? (
        <Text variant="caption" tone="textMuted">
          {t('transactions.fields.tagLimit', { count: MAX_TAGS })}
        </Text>
      ) : null}
      {suggestions.length > 0 && !full ? (
        <View style={styles.suggestions}>
          {suggestions.map((tag) => (
            <TagChip
              key={tag.id}
              name={tag.name}
              variant="outline"
              onPress={() => add(tag.name)}
              accessibilityLabel={`${t('transactions.fields.addTag')}: ${tag.name}`}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: { gap: t.spacing.xs },
  box: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: t.spacing.sm,
    minHeight: 52,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.md,
    borderCurve: 'continuous',
    backgroundColor: t.colors.surface,
  },
  input: {
    flexGrow: 1,
    minWidth: 120,
    ...t.typography.body,
    paddingVertical: t.spacing.xs,
  },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm },
}));
