import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Icon, IconButton, Text, TextField } from '@/components/ui';
import { normalizeSearchText } from '@/domain/text/search';
import { useTags } from '@/features/categories/hooks';
import { makeStyles, useTheme } from '@/theme';

/** Free-form tags with suggestions from existing tags (matched case-insensitively). */
export function TagInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const [text, setText] = useState('');
  const tags = useTags();

  const has = (name: string) =>
    value.some((v) => normalizeSearchText(v) === normalizeSearchText(name));

  const add = (raw: string) => {
    const name = raw.trim().slice(0, 50);
    if (!name || has(name) || value.length >= 20) return;
    // Reuse an existing tag's spelling when it matches.
    const existing = tags.data?.find(
      (tag) => normalizeSearchText(tag.name) === normalizeSearchText(name),
    );
    onChange([...value, existing?.name ?? name]);
    setText('');
  };

  const suggestions = useMemo(() => {
    const q = normalizeSearchText(text);
    return (tags.data ?? [])
      .filter((tag) => !has(tag.name) && (!q || normalizeSearchText(tag.name).includes(q)))
      .slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tags.data, text, value]);

  return (
    <View style={styles.container}>
      <TextField
        label={t('transactions.fields.tags')}
        value={text}
        onChangeText={setText}
        placeholder={t('transactions.fields.tagPlaceholder')}
        returnKeyType="done"
        onSubmitEditing={() => add(text)}
        maxLength={50}
        trailing={
          <IconButton
            icon="add-circle-outline"
            accessibilityLabel={t('transactions.fields.addTag')}
            tone="primary"
            disabled={!text.trim()}
            onPress={() => add(text)}
          />
        }
      />
      {value.length > 0 ? (
        <View style={styles.chips}>
          {value.map((tag) => (
            <Pressable
              key={tag}
              accessibilityRole="button"
              accessibilityLabel={t('transactions.fields.removeTag', { name: tag })}
              onPress={() => onChange(value.filter((v) => v !== tag))}
              style={[styles.chip, { backgroundColor: theme.colors.primaryMuted }]}
            >
              <Text variant="label" style={{ color: theme.colors.onPrimaryMuted }}>
                {tag}
              </Text>
              <Icon name="close" size={16} tone="onPrimaryMuted" />
            </Pressable>
          ))}
        </View>
      ) : null}
      {suggestions.length > 0 ? (
        <View style={styles.chips}>
          {suggestions.map((tag) => (
            <Pressable
              key={tag.id}
              accessibilityRole="button"
              accessibilityLabel={`${t('transactions.fields.addTag')}: ${tag.name}`}
              onPress={() => add(tag.name)}
              style={[styles.chip, styles.suggestion]}
            >
              <Icon name="add" size={16} tone="textSecondary" />
              <Text variant="label" tone="textSecondary">
                {tag.name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: { gap: t.spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
    minHeight: 40,
    paddingHorizontal: t.spacing.md,
    borderRadius: t.radius.pill,
  },
  suggestion: { borderWidth: 1, borderColor: t.colors.borderStrong },
}));
