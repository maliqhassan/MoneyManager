import type { PropsWithChildren, ReactElement } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  type RefreshControlProps,
  ScrollView,
  View,
} from 'react-native';
import { type Edge, SafeAreaView } from 'react-native-safe-area-context';

import { makeStyles } from '@/theme';

export interface ScreenProps extends PropsWithChildren {
  /** Wrap content in a ScrollView (default true). */
  scroll?: boolean;
  /** Safe-area edges to pad. Tab screens with a native header usually need none on top. */
  edges?: Edge[];
  /** Avoid the keyboard (forms). */
  keyboard?: boolean;
  refreshControl?: ReactElement<RefreshControlProps>;
  /** Content pinned below the scroll area (e.g. primary action). */
  footer?: React.ReactNode;
  padded?: boolean;
}

export function Screen({
  children,
  scroll = true,
  edges = ['bottom'],
  keyboard = false,
  refreshControl,
  footer,
  padded = true,
}: ScreenProps) {
  const styles = useStyles();
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.content, padded && styles.padded]}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, styles.content, padded && styles.padded]}>{children}</View>
  );

  const body = (
    <>
      {content}
      {footer ? <View style={[styles.footer, padded && styles.padded]}>{footer}</View> : null}
    </>
  );

  return (
    <SafeAreaView style={styles.root} edges={edges}>
      {keyboard ? (
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.background },
  fill: { flex: 1 },
  content: { flexGrow: 1, gap: t.spacing.lg },
  padded: { paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.lg },
  footer: { paddingTop: t.spacing.sm },
}));
