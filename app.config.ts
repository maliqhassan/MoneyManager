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
    // Single light theme: system dark mode does not restyle native views.
    userInterfaceStyle: 'light',
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
      // Fonts are embedded at build time (no async loading at launch). On
      // Android each typeface is one family so fontWeight picks the file.
      [
        'expo-font',
        {
          android: {
            fonts: [
              {
                fontFamily: 'Inter',
                fontDefinitions: [
                  { path: './assets/fonts/Inter_400Regular.ttf', weight: 400 },
                  { path: './assets/fonts/Inter_500Medium.ttf', weight: 500 },
                  { path: './assets/fonts/Inter_600SemiBold.ttf', weight: 600 },
                ],
              },
              {
                fontFamily: 'PlusJakartaSans',
                fontDefinitions: [
                  { path: './assets/fonts/PlusJakartaSans_600SemiBold.ttf', weight: 600 },
                  { path: './assets/fonts/PlusJakartaSans_700Bold.ttf', weight: 700 },
                  { path: './assets/fonts/PlusJakartaSans_800ExtraBold.ttf', weight: 800 },
                ],
              },
            ],
          },
          ios: {
            fonts: [
              './assets/fonts/Inter_400Regular.ttf',
              './assets/fonts/Inter_500Medium.ttf',
              './assets/fonts/Inter_600SemiBold.ttf',
              './assets/fonts/PlusJakartaSans_600SemiBold.ttf',
              './assets/fonts/PlusJakartaSans_700Bold.ttf',
              './assets/fonts/PlusJakartaSans_800ExtraBold.ttf',
            ],
          },
        },
      ],
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
          backgroundColor: '#F4F3FB',
        },
      ],
      // Local reminders only (no push). No exact-alarm permission: Android may
      // deliver reminders a little late; that is stated in the app.
      ['expo-notifications', { icon: './assets/android-icon-monochrome.png', color: '#5B45E0' }],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      appVariant: variant,
    },
  };
};
