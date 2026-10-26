import { Children, Fragment, type PropsWithChildren, type ReactNode } from 'react';
import { Pressable, TextInput, type TextInputProps, View } from 'react-native';

import { makeStyles, useTheme } from '@/theme';

import { Icon } from './Icon';
import { useKeyboardAware } from './Screen';
import { Text } from './Text';

/** A white card of label/value rows separated by hairlines (settings-style form). */
export function FormGroup({ children }: PropsWithChildren) {
  const styles = useStyles();
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.group}>
      {rows.map((row, i) => (
        <Fragment key={i}>
          {i > 0 ? <View style={styles.divider} /> : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

/** Label on the left, value on the right; pressable when `onPress` is set. */
export function FormRow({
  label,
  value,
  placeholder,
  onPress,
  accessibilityLabel,
  trailing,
}: {
  label: string;
  value?: string | null;
  placeholder?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  trailing?: ReactNode;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const shown = value || placeholder || '';
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel ?? `${label}: ${shown}`}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && onPress && { backgroundColor: theme.colors.surfaceMuted },
      ]}
    >
      <Text variant="label" tone="textSecondary">
        {label}
      </Text>
      <View style={styles.valueBox}>
        <Text
          variant="body"
          tone={value ? 'text' : 'textMuted'}
          numberOfLines={1}
          style={styles.value}
        >
          {shown}
        </Text>
        {trailing}
        {onPress ? <Icon name="chevron-forward" size={16} tone="textMuted" /> : null}
      </View>
    </Pressable>
  );
}

/** A row whose value is typed in place (e.g. merchant, note). */
export function FormInputRow({
  label,
  onFocus,
  ...input
}: Omit<TextInputProps, 'style'> & { label: string }) {
  const theme = useTheme();
  const styles = useStyles();
  const keyboardAware = useKeyboardAware();
  return (
    <View style={styles.row}>
      <Text variant="label" tone="textSecondary" nativeID={`${label}-row-label`}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityLabelledBy={`${label}-row-label`}
        placeholderTextColor={theme.colors.textMuted}
        selectionColor={theme.colors.primary}
        style={[styles.input, { color: theme.colors.text }]}
        onFocus={(e) => {
          keyboardAware?.revealFocusedInput();
          onFocus?.(e);
        }}
        {...input}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  group: {
    borderRadius: t.radius.lg,
    borderCurve: 'continuous',
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
    overflow: 'hidden',
  },
  divider: { height: 1, backgroundColor: t.colors.border, marginStart: t.spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing.md,
    minHeight: 52,
    paddingHorizontal: t.spacing.lg,
  },
  valueBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
    flexShrink: 1,
  },
  value: { flexShrink: 1, textAlign: 'right' },
  input: {
    flex: 1,
    ...t.typography.body,
    textAlign: 'right',
    paddingVertical: t.spacing.md,
  },
}));
