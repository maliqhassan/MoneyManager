import { forwardRef, useState } from 'react';
import { TextInput, type TextInputProps, View } from 'react-native';

import { makeStyles, useTheme } from '@/theme';

import { IconButton } from './IconButton';
import { useKeyboardAware } from './Screen';
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
  /** Short text before the input, e.g. a currency symbol. */
  prefix?: string;
  /** Extra control after the input, e.g. a sign toggle. */
  trailing?: React.ReactNode;
  /** Extra line under the field (e.g. a live preview), shown when there is no error. */
  footer?: React.ReactNode;
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
    prefix,
    trailing,
    footer,
    ...rest
  },
  ref,
) {
  const theme = useTheme();
  const styles = useStyles();
  const keyboardAware = useKeyboardAware();
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
        {prefix ? (
          <Text variant="body" tone="textSecondary" importantForAccessibility="no">
            {prefix}
          </Text>
        ) : null}
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
            keyboardAware?.revealFocusedInput();
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
        {trailing}
      </View>
      {hasError ? (
        <Text variant="bodySmall" tone="negative" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : (
        <>
          {footer}
          {hint ? (
            <Text variant="bodySmall" tone="textMuted">
              {hint}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
});

const useStyles = makeStyles((t) => ({
  container: { gap: t.spacing.xs },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: t.radius.md,
    borderCurve: 'continuous',
    minHeight: 52,
    gap: t.spacing.xs,
    paddingStart: t.spacing.md,
    paddingEnd: t.spacing.xs,
  },
  input: {
    flex: 1,
    ...t.typography.body,
    paddingVertical: t.spacing.md,
  },
}));
