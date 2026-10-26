import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Icon, type IconName, Text } from '@/components/ui';
import { useLocalModeStore } from '@/stores/localModeStore';
import { makeStyles, useTheme } from '@/theme';

const SLIDES: {
  key: 'track' | 'plan' | 'understand';
  icon: IconName;
  satellites: [IconName, IconName];
}[] = [
  { key: 'track', icon: 'wallet', satellites: ['cash-outline', 'card-outline'] },
  { key: 'plan', icon: 'calendar', satellites: ['pie-chart-outline', 'notifications-outline'] },
  {
    key: 'understand',
    icon: 'bar-chart',
    satellites: ['trending-up-outline', 'pricetags-outline'],
  },
];

/**
 * First screen on a new device: three short slides, then "Get started"
 * (no account — data stays on this device) or "I already have an account".
 */
export default function WelcomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const last = index === SLIDES.length - 1;

  const goTo = (next: number) => {
    scrollRef.current?.scrollTo({ x: next * width, animated: !theme.reduceMotion });
    setIndex(next);
  };
  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / Math.max(width, 1)));
  };

  const getStarted = () => {
    useLocalModeStore.getState().startGuest();
    router.replace('/');
  };
  const signIn = () => {
    useLocalModeStore.getState().markIntroSeen();
    router.push('/sign-in');
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <Text variant="label" tone="primary" style={styles.brand}>
          {t('common.appName')}
        </Text>
        {!last ? (
          <Button
            label={t('intro.skip')}
            variant="ghost"
            size="md"
            fullWidth={false}
            onPress={() => goTo(SLIDES.length - 1)}
          />
        ) : null}
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        style={styles.pager}
      >
        {SLIDES.map((slide, i) => (
          <View
            key={slide.key}
            style={[styles.slide, { width }]}
            accessible
            accessibilityLabel={`${t(`intro.${slide.key}.title`)}. ${t(`intro.${slide.key}.body`)}. ${t('intro.slideLabel', { current: i + 1, total: SLIDES.length })}`}
          >
            <View style={styles.art} importantForAccessibility="no-hide-descendants">
              <View style={styles.halo}>
                <View style={styles.core}>
                  <Icon name={slide.icon} size={44} tone="onPrimary" />
                </View>
              </View>
              <View style={[styles.satellite, styles.satelliteLeft]}>
                <Icon name={slide.satellites[0]} size={22} tone="primary" />
              </View>
              <View style={[styles.satellite, styles.satelliteRight]}>
                <Icon name={slide.satellites[1]} size={22} tone="primary" />
              </View>
            </View>
            <Text variant="title" align="center">
              {t(`intro.${slide.key}.title`)}
            </Text>
            <Text variant="body" tone="textSecondary" align="center" style={styles.body}>
              {t(`intro.${slide.key}.body`)}
            </Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.dots} importantForAccessibility="no-hide-descendants">
        {SLIDES.map((s, i) => (
          <View key={s.key} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>

      <View style={styles.actions}>
        {last ? (
          <Button label={t('intro.getStarted')} onPress={getStarted} />
        ) : (
          <Button label={t('intro.next')} onPress={() => goTo(index + 1)} />
        )}
        <Button label={t('intro.haveAccount')} variant="secondary" onPress={signIn} />
        <Text variant="caption" tone="textMuted" align="center">
          {t('intro.noAccountNeeded')}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: t.spacing.lg,
    minHeight: t.minTouchTarget,
  },
  brand: { letterSpacing: 0.6 },
  pager: { flexGrow: 1 },
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: t.spacing.xl,
    gap: t.spacing.md,
  },
  art: { width: 220, height: 200, alignItems: 'center', justifyContent: 'center' },
  halo: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: t.colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  core: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: t.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...t.elevation.medium,
  },
  satellite: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...t.elevation.low,
  },
  satelliteLeft: { left: 4, top: 24 },
  satelliteRight: { right: 4, bottom: 24 },
  body: { maxWidth: 340 },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: t.spacing.sm,
    paddingVertical: t.spacing.md,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.colors.borderStrong },
  dotActive: { width: 24, backgroundColor: t.colors.primary },
  actions: { paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.lg, gap: t.spacing.sm },
}));
