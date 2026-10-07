import { View } from 'react-native';

import { type ColorScheme, makeStyles, useTheme } from '@/theme';

export type ProgressTone = 'primary' | 'positive' | 'warning' | 'negative';

const FILL: Record<ProgressTone, keyof ColorScheme> = {
  primary: 'primary',
  positive: 'positive',
  warning: 'warning',
  negative: 'negative',
};

export interface ProgressBarProps {
  /** Progress in basis points (10 000 = 100%). Values outside 0–10 000 are clamped visually. */
  valueBasisPoints: number;
  tone?: ProgressTone;
  /** Spoken description, e.g. "Groceries: 62% of budget used". */
  accessibilityLabel: string;
  height?: number;
}

export function ProgressBar({
  valueBasisPoints,
  tone = 'primary',
  accessibilityLabel,
  height = 8,
}: ProgressBarProps) {
  const theme = useTheme();
  const styles = useStyles();
  const clamped = Math.max(0, Math.min(10_000, valueBasisPoints));
  const percent = Math.round(clamped / 100);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={[styles.track, { height, borderRadius: height / 2 }]}
    >
      <View
        style={{
          width: `${clamped / 100}%`,
          height,
          borderRadius: height / 2,
          backgroundColor: theme.colors[FILL[tone]],
        }}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  track: { backgroundColor: t.colors.surfaceMuted, overflow: 'hidden', width: '100%' },
}));
