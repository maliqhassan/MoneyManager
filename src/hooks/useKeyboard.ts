import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, type KeyboardEvent, Platform, type View } from 'react-native';

// iOS announces the keyboard before it moves; Android only after it is shown.
const SHOW_EVENT = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
const HIDE_EVENT = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

function initialKeyboardTop(): number | null {
  try {
    return Keyboard.isVisible() ? (Keyboard.metrics()?.screenY ?? null) : null;
  } catch {
    return null;
  }
}

/** Whether the software keyboard is currently shown. */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(() => initialKeyboardTop() !== null);
  useEffect(() => {
    const subs = [
      Keyboard.addListener(SHOW_EVENT, (e: KeyboardEvent) =>
        // iOS also reports a frame change when the keyboard slides off-screen.
        setVisible(e.endCoordinates.height > 0),
      ),
      Keyboard.addListener(HIDE_EVENT, () => setVisible(false)),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);
  return visible;
}

/**
 * How far the keyboard overlaps the view behind `ref`, in points. Attach the
 * returned `onLayout` to that view too.
 *
 * Measured in window coordinates, so it is right whether or not the OS
 * resized the window for the keyboard (Android edge-to-edge does not; older
 * Android adjustResize does, which makes the overlap 0) and whatever headers
 * or safe-area padding sit above the view. Pad the view's content by this
 * amount; the view's own frame must not depend on it. Listens only while
 * `enabled`.
 */
export function useKeyboardOverlap(ref: RefObject<View | null>, enabled = true) {
  const keyboardTop = useRef<number | null>(initialKeyboardTop());
  const [overlap, setOverlap] = useState(0);

  const measure = useCallback(() => {
    const top = keyboardTop.current;
    const view = ref.current;
    if (top === null || !view) {
      setOverlap(0);
      return;
    }
    view.measureInWindow((_x, y, _width, height) => {
      if (keyboardTop.current === null) return;
      setOverlap(Math.max(0, Math.round(y + height - top)));
    });
  }, [ref]);

  useEffect(() => {
    if (!enabled) return undefined;
    keyboardTop.current = initialKeyboardTop();
    const subs = [
      Keyboard.addListener(SHOW_EVENT, (e: KeyboardEvent) => {
        keyboardTop.current = e.endCoordinates.height > 0 ? e.endCoordinates.screenY : null;
        measure();
      }),
      Keyboard.addListener(HIDE_EVENT, () => {
        keyboardTop.current = null;
        setOverlap(0);
      }),
    ];
    measure();
    return () => subs.forEach((s) => s.remove());
  }, [measure, enabled]);

  return { overlap: enabled ? overlap : 0, onLayout: measure };
}
