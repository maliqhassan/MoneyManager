import type { ReactNode } from 'react';
import { View } from 'react-native';

import { type ColorScheme, useTheme } from '@/theme';

/**
 * Circular progress built from plain views (no SVG): two clipped half
 * rings rotated into place. `basisPoints` 0–10 000 fills clockwise from the
 * top; above 10 000 the ring is full. Decorative — pair it with a written
 * value (`children` is drawn in the middle).
 */
export function ProgressRing({
  basisPoints,
  size = 64,
  stroke = 6,
  tone = 'primary',
  children,
}: {
  basisPoints: number;
  size?: number;
  stroke?: number;
  tone?: keyof ColorScheme;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const p = Math.min(Math.max(basisPoints, 0), 10_000) / 10_000;
  const color = theme.colors[tone];
  const ring = {
    position: 'absolute' as const,
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: stroke,
  };
  // A ring coloured on its left and bottom sides is an arc from 135° to 315°
  // (clockwise from the top); rotating it places the arc's end at the progress.
  const arc = (rotation: number) => ({
    ...ring,
    borderTopColor: 'transparent',
    borderRightColor: 'transparent',
    borderLeftColor: color,
    borderBottomColor: color,
    transform: [{ rotate: `${rotation}deg` }],
  });

  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <View style={[ring, { borderColor: theme.colors.surfaceMuted }]} />
      {p > 0 ? (
        // Right half: 0° → min(p, ½)·360°.
        <View
          style={{
            position: 'absolute',
            left: size / 2,
            top: 0,
            width: size / 2,
            height: size,
            overflow: 'hidden',
          }}
        >
          <View style={[arc(45 + 360 * Math.min(p, 0.5)), { left: -size / 2 }]} />
        </View>
      ) : null}
      {p > 0.5 ? (
        // Left half: 180° → p·360°.
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: size / 2,
            height: size,
            overflow: 'hidden',
          }}
        >
          <View style={arc(360 * p - 315)} />
        </View>
      ) : null}
      {children}
    </View>
  );
}
