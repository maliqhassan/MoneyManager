import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { FormTextField } from '@/components/form/FormTextField';
import { Button, Divider, Screen, Text } from '@/components/ui';
import { AuthHeader } from '@/features/auth/components/AuthHeader';
import { FormError } from '@/features/auth/components/FormError';
import { type SignInValues, signInSchema } from '@/features/auth/schemas';
import { signInWithEmail, signInWithGoogle } from '@/features/auth/services/authService';
import { toAppError } from '@/lib/errors';
import { useLocalModeStore } from '@/stores/localModeStore';
import { makeStyles } from '@/theme';

export default function SignInScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const { control, handleSubmit } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });

  const emailSignIn = useMutation({
    mutationFn: (v: SignInValues) => signInWithEmail(v.email, v.password),
  });
  const googleSignIn = useMutation({ mutationFn: signInWithGoogle });
  const googleError =
    googleSignIn.error && toAppError(googleSignIn.error).code !== 'auth_cancelled'
      ? googleSignIn.error
      : null;
  const busy = emailSignIn.isPending || googleSignIn.isPending;
  // Opened from local-only use (Settings → Back up & sync): data merges on sign-in.
  const isLocalOnly = useLocalModeStore((s) => s.guestId !== null);

  return (
    <Screen keyboard edges={['bottom']}>
      <View style={styles.hero}>
        <Text variant="caption" tone="primary" style={styles.brand}>
          {t('common.appName')}
        </Text>
        <AuthHeader title={t('auth.welcomeTitle')} subtitle={t('auth.welcomeSubtitle')} />
      </View>

      <Button
        label={t('auth.continueWithGoogle')}
        icon="logo-google"
        variant="secondary"
        loading={googleSignIn.isPending}
        disabled={busy}
        onPress={() => googleSignIn.mutate()}
      />
      <FormError error={googleError} />

      <View style={styles.dividerRow}>
        <View style={styles.dividerLine}>
          <Divider />
        </View>
        <Text variant="caption" tone="textMuted">
          {t('common.or')}
        </Text>
        <View style={styles.dividerLine}>
          <Divider />
        </View>
      </View>

      <FormTextField
        control={control}
        name="email"
        label={t('auth.email')}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="next"
      />
      <FormTextField
        control={control}
        name="password"
        label={t('auth.password')}
        secureTextEntry
        secureToggle
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={handleSubmit((v) => emailSignIn.mutate(v))}
      />
      <FormError error={emailSignIn.error} />
      <Button
        label={t('auth.signIn')}
        loading={emailSignIn.isPending}
        disabled={busy}
        onPress={handleSubmit((v) => emailSignIn.mutate(v))}
      />

      <Link href="/forgot-password" asChild>
        <Button label={t('auth.forgotPassword')} variant="ghost" size="md" />
      </Link>
      <View style={styles.footer}>
        <Text variant="bodySmall" tone="textSecondary">
          {t('auth.noAccount')}
        </Text>
        <Link href="/sign-up" asChild>
          <Button label={t('auth.signUp')} variant="ghost" size="md" fullWidth={false} />
        </Link>
      </View>
      {isLocalOnly ? (
        <Text variant="bodySmall" tone="textSecondary" align="center">
          {t('localMode.body')}
        </Text>
      ) : (
        <Button
          label={t('localMode.continueWithout')}
          variant="ghost"
          size="md"
          disabled={busy}
          onPress={() => {
            useLocalModeStore.getState().startGuest();
            router.replace('/');
          }}
        />
      )}
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  hero: { marginTop: t.spacing.md, gap: t.spacing.sm },
  brand: { letterSpacing: 1.2, textTransform: 'uppercase' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md },
  dividerLine: { flex: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
}));
