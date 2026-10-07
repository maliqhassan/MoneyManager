import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Build variants. Selected with the APP_VARIANT environment variable
 * (set per profile in eas.json). Each variant gets its own bundle identifier
 * so development, preview and production builds can be installed side by side.
 */
type AppVariant = 'development' | 'preview' | 'production';

const VARIANTS: Record<AppVariant, { name: string; idSuffix: string; scheme: string }> = {
  development: { name: 'MoneyManager (Dev)', idSuffix: '.dev', scheme: 'moneymanager-dev' },
  preview: {
    name: 'MoneyManager (Preview)',
    idSuffix: '.preview',
    scheme: 'moneymanager-preview',
  },
  production: { name: 'MoneyManager', idSuffix: '', scheme: 'moneymanager' },
};

// TODO(release): replace with the final reverse-DNS identifier before the first store build.
const BASE_BUNDLE_ID = 'com.maliqhassan.moneymanager';

function resolveVariant(value: string | undefined): AppVariant {
  return value === 'preview' || value === 'production' ? value : 'development';
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = resolveVariant(process.env.APP_VARIANT);
  const { name, idSuffix, scheme } = VARIANTS[variant];
  const bundleId = `${BASE_BUNDLE_ID}${idSuffix}`;

  return {
    ...config,
    name,
    slug: 'moneymanager',
    version: '0.1.0',
    scheme,
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier: bundleId,
      supportsTablet: true,
      config: { usesNonExemptEncryption: false },
    },
    android: {
      package: bundleId,
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      // Financial data lives in the local database and is synced to Supabase;
      // keep it out of Android cloud backups.
      allowBackup: false,
    },
    plugins: [
      'expo-router',
      'expo-localization',
      'expo-web-browser',
      'expo-sqlite',
      ['expo-secure-store', { configureAndroidBackup: true }],
      [
        'expo-image-picker',
        {
          photosPermission: 'MoneyManager lets you attach receipt photos to your transactions.',
          cameraPermission: 'MoneyManager uses the camera to photograph receipts.',
          microphonePermission: false,
        },
      ],
      [
        'expo-splash-screen',
        {
          image: './assets/splash-icon.png',
          imageWidth: 160,
          resizeMode: 'contain',
          backgroundColor: '#F6F7F9',
          dark: { image: './assets/splash-icon.png', backgroundColor: '#0B0F14' },
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      appVariant: variant,
    },
  };
};
