import { View } from 'react-native';

import { type ColorScheme, MAX_FONT_SCALE_DENSE, makeStyles, useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type BadgeTone = 'neutral' | 'primary' | 'positive' | 'negative' | 'warning';

const TONES: Record<BadgeTone, { bg: keyof ColorScheme; fg: keyof ColorScheme }> = {
  neutral: { bg: 'surfaceMuted', fg: 'textSecondary' },
  primary: { bg: 'primaryMuted', fg: 'onPrimaryMuted' },
  positive: { bg: 'positiveMuted', fg: 'positive' },
  negative: { bg: 'negativeMuted', fg: 'negative' },
  warning: { bg: 'warningMuted', fg: 'warning' },
};

/**
 * A small status tag ("Repeats", "Refund", "Archived", "3 filters"). Rounded
 * rectangle, tinted background, 12 pt. `caps` renders a one- or two-word
 * status in letter-spaced capitals; longer text stays in sentence case.
 */
export function Badge({
  label,
  tone = 'neutral',
  icon,
  caps = false,
}: {
  label: string;
  tone?: BadgeTone;
  icon?: IconName;
  caps?: boolean;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const colors = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: theme.colors[colors.bg] }]}>
      {icon ? <Icon name={icon} size={12} tone={colors.fg} /> : null}
      <Text
        variant={caps ? 'overline' : 'caption'}
        maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}
        numberOfLines={1}
        style={[{ color: theme.colors[colors.fg] }, !caps && styles.strong]}
      >
        {label}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
    minHeight: 22,
    borderRadius: t.radius.sm,
    borderCurve: 'continuous',
    paddingHorizontal: t.spacing.sm,
  },
  strong: { fontWeight: '600' },
}));
