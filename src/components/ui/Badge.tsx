import { View } from 'react-native';

import { type ColorScheme, MAX_FONT_SCALE_DENSE, makeStyles, useTheme } from '@/theme';

import { Text } from './Text';

export type BadgeTone = 'neutral' | 'primary' | 'positive' | 'negative' | 'warning';

const TONES: Record<BadgeTone, { bg: keyof ColorScheme; fg: keyof ColorScheme }> = {
  neutral: { bg: 'surfaceMuted', fg: 'textSecondary' },
  primary: { bg: 'primaryMuted', fg: 'onPrimaryMuted' },
  positive: { bg: 'positiveMuted', fg: 'positive' },
  negative: { bg: 'negativeMuted', fg: 'negative' },
  warning: { bg: 'warningMuted', fg: 'warning' },
};

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  const theme = useTheme();
  const styles = useStyles();
  const colors = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: theme.colors[colors.bg] }]}>
      <Text
        variant="caption"
        maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}
        style={{ color: theme.colors[colors.fg], fontWeight: '600' }}
      >
        {label}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xxs,
  },
}));
