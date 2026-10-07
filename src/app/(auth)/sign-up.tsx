import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { FormTextField } from '@/components/form/FormTextField';
import { Button, EmptyState, Screen } from '@/components/ui';
import { AuthHeader } from '@/features/auth/components/AuthHeader';
import { FormError } from '@/features/auth/components/FormError';
import { type SignUpValues, signUpSchema } from '@/features/auth/schemas';
import { signUpWithEmail } from '@/features/auth/services/authService';

export default function SignUpScreen() {
  const { t } = useTranslation();
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const { control, handleSubmit } = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { email: '', password: '', confirmPassword: '' },
  });

  const signUp = useMutation({
    mutationFn: (v: SignUpValues) => signUpWithEmail(v.email, v.password),
    onSuccess: (needsConfirmation, v) => {
      // When confirmation is disabled the session starts and the guard navigates away.
      if (needsConfirmation) setPendingEmail(v.email);
    },
  });

  if (pendingEmail) {
    return (
      <Screen edges={['bottom']}>
        <EmptyState
          icon="mail-unread-outline"
          title={t('auth.checkEmailTitle')}
          description={t('auth.checkEmailBody', { email: pendingEmail })}
        />
        <Button label={t('auth.backToSignIn')} variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  const submit = handleSubmit((v) => signUp.mutate(v));
  return (
    <Screen keyboard edges={['bottom']}>
      <AuthHeader title={t('auth.signUp')} />
      <FormTextField
        control={control}
        name="email"
        label={t('auth.email')}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <FormTextField
        control={control}
        name="password"
        label={t('auth.password')}
        hint={t('auth.passwordHint')}
        secureTextEntry
        secureToggle
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <FormTextField
        control={control}
        name="confirmPassword"
        label={t('auth.confirmPassword')}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        onSubmitEditing={submit}
      />
      <FormError error={signUp.error} />
      <Button label={t('auth.signUp')} loading={signUp.isPending} onPress={submit} />
    </Screen>
  );
}
