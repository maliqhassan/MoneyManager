import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Button, Text } from '@/components/ui';
import { useLocalModeStore } from '@/stores/localModeStore';
import { makeStyles, useTheme } from '@/theme';

/**
 * One-time tips on first use, each pointing at a real control. Controls opt
 * in with `ref={tipAnchor('add')}`; a tip whose control is not on screen is
 * skipped. Dismissed tips are remembered on the device.
 */

export type TipId = 'add' | 'settings' | 'reports';

interface Measurable {
  measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void;
}

const anchors = new Map<TipId, Measurable>();

/** Ref callback that registers a control as the target of a tip. */
export function tipAnchor(id: TipId) {
  return (node: Measurable | null) => {
    if (node) anchors.set(id, node);
    else anchors.delete(id);
  };
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const measure = (node: Measurable) =>
  new Promise<Rect | null>((resolve) => {
    node.measureInWindow((x, y, width, height) =>
      resolve(width > 0 && height > 0 ? { x, y, width, height } : null),
    );
  });

/** Delay before the first tip, so the screen has settled. */
const START_DELAY_MS = 900;
const BUBBLE_WIDTH = 300;

export function FirstRunTips({ order }: { order: readonly TipId[] }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const window = useWindowDimensions();
  const seen = useLocalModeStore((s) => s.tipsSeen);
  const markTipSeen = useLocalModeStore((s) => s.markTipSeen);
  const pending = order.filter((id) => !seen[id]);
  const [active, setActive] = useState<{ id: TipId; rect: Rect } | null>(null);
  const started = useRef(false);

  const showFrom = useCallback(async (queue: readonly TipId[]) => {
    for (const id of queue) {
      const node = anchors.get(id);
      const rect = node ? await measure(node) : null;
      if (rect) {
        setActive({ id, rect });
        return;
      }
    }
    setActive(null);
  }, []);

  useEffect(() => {
    if (started.current || pending.length === 0) return undefined;
    started.current = true;
    const timer = setTimeout(() => void showFrom(pending), START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pending, showFrom]);

  if (!active) return null;

  // Tips whose control is not on screen are skipped, so they don't count.
  const remaining = order.filter((id) => !seen[id] && id !== active.id && anchors.has(id));
  const index = order.indexOf(active.id);
  const next = () => {
    markTipSeen(active.id);
    void showFrom(remaining);
  };
  const dismissAll = () => {
    for (const id of order) markTipSeen(id);
    setActive(null);
  };

  const { rect } = active;
  const below = rect.y + rect.height / 2 < window.height / 2;
  const width = Math.min(BUBBLE_WIDTH, window.width - 32);
  const left = Math.min(
    Math.max(16, rect.x + rect.width / 2 - width / 2),
    window.width - 16 - width,
  );
  const pad = 6;

  return (
    <Modal
      visible
      transparent
      animationType={theme.reduceMotion ? 'none' : 'fade'}
      onRequestClose={dismissAll}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <Pressable
        style={[StyleSheet.absoluteFill, styles.backdrop]}
        onPress={next}
        accessibilityRole="button"
        accessibilityLabel={remaining.length > 0 ? t('tips.next') : t('tips.done')}
      />
      <View
        pointerEvents="none"
        style={[
          styles.ring,
          {
            left: rect.x - pad,
            top: rect.y - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
          },
        ]}
      />
      <View
        accessibilityViewIsModal
        accessibilityLiveRegion="polite"
        style={[
          styles.bubble,
          { width, left },
          below
            ? { top: rect.y + rect.height + pad + 12 }
            : { bottom: window.height - rect.y + pad + 12 },
        ]}
      >
        <Text variant="caption" tone="textSecondary">
          {t('tips.step', { current: index + 1, total: order.length })}
        </Text>
        <Text variant="heading">{t(`tips.${active.id}.title`)}</Text>
        <Text variant="bodySmall" tone="textSecondary">
          {t(`tips.${active.id}.body`)}
        </Text>
        <View style={styles.actions}>
          {remaining.length > 0 ? (
            <Button
              label={t('intro.skip')}
              variant="ghost"
              size="md"
              fullWidth={false}
              onPress={dismissAll}
            />
          ) : null}
          <Button
            label={remaining.length > 0 ? t('tips.next') : t('tips.done')}
            size="md"
            fullWidth={false}
            onPress={next}
          />
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  backdrop: { backgroundColor: t.colors.overlay },
  ring: {
    position: 'absolute',
    borderRadius: t.radius.lg,
    borderWidth: 2,
    borderColor: t.colors.surface,
  },
  bubble: {
    position: 'absolute',
    gap: t.spacing.xs,
    padding: t.spacing.lg,
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.surface,
    ...t.elevation.medium,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: t.spacing.sm,
    marginTop: t.spacing.sm,
  },
}));
