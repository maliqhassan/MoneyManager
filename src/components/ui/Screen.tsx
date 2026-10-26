import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  type RefreshControlProps,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { type Edge, SafeAreaView } from 'react-native-safe-area-context';

import { useKeyboardOverlap } from '@/hooks/useKeyboard';
import { makeStyles, useTheme } from '@/theme';

export interface ScreenProps extends PropsWithChildren {
  /** Wrap content in a ScrollView (default true). */
  scroll?: boolean;
  /** Safe-area edges to pad. Tab screens with a native header usually need none on top. */
  edges?: Edge[];
  /**
   * Keyboard-aware form layout: content and footer are lifted above the
   * keyboard, the focused field is scrolled into view, and dragging the
   * content dismisses the keyboard (typed values are kept).
   */
  keyboard?: boolean;
  refreshControl?: ReactElement<RefreshControlProps>;
  /** Content pinned below the scroll area (e.g. primary action). Stays above the keyboard. */
  footer?: React.ReactNode;
  padded?: boolean;
}

/** Space kept between the focused field and the keyboard / top edge (room for its error text). */
const REVEAL_MARGIN = 32;

interface KeyboardAware {
  /** Scrolls the focused input into view if the keyboard hides it. */
  revealFocusedInput: () => void;
}

const KeyboardAwareContext = createContext<KeyboardAware | null>(null);

/** Used by inputs (TextField) to stay visible when focused inside a keyboard-aware Screen. */
export function useKeyboardAware(): KeyboardAware | null {
  return useContext(KeyboardAwareContext);
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
  const theme = useTheme();
  const bodyRef = useRef<View>(null);
  const keyboardInset = useKeyboardOverlap(bodyRef, keyboard);
  const overlap = keyboardInset.overlap;
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const revealFocusedInput = useCallback(() => {
    if (revealTimer.current) clearTimeout(revealTimer.current);
    // Wait a frame so the keyboard padding has been laid out.
    revealTimer.current = setTimeout(() => {
      const input = TextInput.State?.currentlyFocusedInput?.();
      const scrollView = scrollRef.current;
      const viewport = scrollView?.getNativeScrollRef();
      if (!input || !scrollView || !viewport) return;
      input.measureInWindow((_x, y, _w, h) => {
        viewport.measureInWindow((_sx, sy, _sw, sh) => {
          const below = y + h + REVEAL_MARGIN - (sy + sh);
          const above = sy + REVEAL_MARGIN - y;
          const delta = below > 0 ? below : above > 0 ? -above : 0;
          if (delta === 0) return;
          scrollView.scrollTo({
            y: Math.max(0, scrollY.current + delta),
            animated: !theme.reduceMotion,
          });
        });
      });
    }, 50);
  }, [theme.reduceMotion]);

  useEffect(() => {
    if (keyboard && scroll && overlap > 0) revealFocusedInput();
  }, [keyboard, scroll, overlap, revealFocusedInput]);

  useEffect(
    () => () => {
      if (revealTimer.current) clearTimeout(revealTimer.current);
    },
    [],
  );

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
  }, []);

  const aware = useMemo(
    () => (keyboard && scroll ? { revealFocusedInput } : null),
    [keyboard, scroll, revealFocusedInput],
  );

  const content = scroll ? (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={[styles.content, padded && styles.padded]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={
        keyboard ? (Platform.OS === 'ios' ? 'interactive' : 'on-drag') : undefined
      }
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={refreshControl}
      onScroll={keyboard ? onScroll : undefined}
      scrollEventThrottle={keyboard ? 32 : undefined}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, styles.content, padded && styles.padded]}>{children}</View>
  );

  return (
    <SafeAreaView style={styles.root} edges={edges}>
      <KeyboardAwareContext.Provider value={aware}>
        <View
          ref={bodyRef}
          testID="screen-body"
          onLayout={keyboard ? keyboardInset.onLayout : undefined}
          style={[styles.fill, overlap > 0 && { paddingBottom: overlap }]}
        >
          {content}
          {footer ? (
            <View
              style={[styles.footer, padded && styles.padded, overlap > 0 && styles.footerRaised]}
            >
              {footer}
            </View>
          ) : null}
        </View>
      </KeyboardAwareContext.Provider>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.background },
  fill: { flex: 1 },
  // Screens breathe: 20 pt side margins, 24 pt between blocks.
  content: { flexGrow: 1, gap: t.spacing.xl },
  padded: { paddingHorizontal: t.spacing.gutter, paddingVertical: t.spacing.lg },
  footer: { paddingTop: t.spacing.sm },
  footerRaised: { paddingBottom: t.spacing.sm },
}));
