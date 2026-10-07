import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';

export const unstable_settings = { initialRouteName: 'sign-in' };

export default function AuthLayout() {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.colors.background },
        headerTintColor: theme.colors.text,
        headerTitle: '',
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Stack.Screen name="sign-in" options={{ headerShown: false, title: t('auth.signIn') }} />
      <Stack.Screen name="sign-up" options={{ title: t('auth.signUp') }} />
      <Stack.Screen name="forgot-password" options={{ title: t('auth.resetTitle') }} />
    </Stack>
  );
}
