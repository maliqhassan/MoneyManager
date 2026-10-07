import { forwardRef, useState } from 'react';
import { TextInput, type TextInputProps, View } from 'react-native';

import { makeStyles, useTheme } from '@/theme';

import { IconButton } from './IconButton';
import { Text } from './Text';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  /** Already-translated error message. */
  error?: string | null;
  hint?: string;
  /** Shows a reveal toggle for secure fields. */
  secureToggle?: boolean;
  revealLabel?: string;
  hideLabel?: string;
}

/**
 * Labelled text input. The label stays visible (no placeholder-as-label), and
 * the error is announced to screen readers through the accessibility hint.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  {
    label,
    error,
    hint,
    secureTextEntry,
    secureToggle = false,
    revealLabel = 'Show password',
    hideLabel = 'Hide password',
    editable = true,
    onFocus,
    onBlur,
    ...rest
  },
  ref,
) {
  const theme = useTheme();
  const styles = useStyles();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const hasError = Boolean(error);

  return (
    <View style={styles.container}>
      <Text variant="label" tone="textSecondary" nativeID={`${label}-label`}>
        {label}
      </Text>
      <View
        style={[
          styles.inputRow,
          {
            borderColor: hasError
              ? theme.colors.negative
              : focused
                ? theme.colors.focusRing
                : theme.colors.borderStrong,
            borderWidth: focused || hasError ? 2 : 1,
            backgroundColor: editable ? theme.colors.surface : theme.colors.surfaceMuted,
          },
        ]}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityLabelledBy={`${label}-label`}
          accessibilityHint={error ?? hint}
          accessibilityState={{ disabled: !editable }}
          editable={editable}
          secureTextEntry={secureTextEntry && !revealed}
          placeholderTextColor={theme.colors.textMuted}
          selectionColor={theme.colors.primary}
          style={[styles.input, { color: theme.colors.text }]}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />
        {secureTextEntry && secureToggle ? (
          <IconButton
            icon={revealed ? 'eye-off-outline' : 'eye-outline'}
            accessibilityLabel={revealed ? hideLabel : revealLabel}
            tone="textSecondary"
            onPress={() => setRevealed((v) => !v)}
          />
        ) : null}
      </View>
      {hasError ? (
        <Text variant="bodySmall" tone="negative" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="bodySmall" tone="textMuted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const useStyles = makeStyles((t) => ({
  container: { gap: t.spacing.xs },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: t.radius.md,
    minHeight: 52,
    paddingStart: t.spacing.md,
    paddingEnd: t.spacing.xs,
  },
  input: {
    flex: 1,
    ...t.typography.body,
    paddingVertical: t.spacing.md,
  },
}));
