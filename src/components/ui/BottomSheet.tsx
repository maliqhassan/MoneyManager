import type { PropsWithChildren } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { makeStyles, useTheme } from '@/theme';

import { IconButton } from './IconButton';
import { Text } from './Text';

export interface BottomSheetProps extends PropsWithChildren {
  visible: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
}

/**
 * Modal sheet anchored to the bottom of the screen. Built on RN Modal (no
 * gesture library) so it is accessible by default: focus is trapped, the
 * Android back button closes it, and the slide animation is skipped when the
 * user prefers reduced motion.
 */
export function BottomSheet({ visible, onClose, title, closeLabel, children }: BottomSheetProps) {
  const theme = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType={theme.reduceMotion ? 'none' : 'slide'}
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
        />
        <View
          style={[styles.sheet, { paddingBottom: insets.bottom + theme.spacing.lg }]}
          accessibilityViewIsModal
        >
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text variant="heading">{title}</Text>
            <IconButton icon="close" accessibilityLabel={closeLabel} onPress={onClose} />
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: t.colors.overlay },
  sheet: {
    backgroundColor: t.colors.surfaceRaised,
    borderTopStartRadius: t.radius.xl,
    borderTopEndRadius: t.radius.xl,
    paddingHorizontal: t.spacing.lg,
    gap: t.spacing.sm,
    ...t.elevation.medium,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.colors.borderStrong,
    marginTop: t.spacing.sm,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
}));
