import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { FormTextField } from '@/components/form/FormTextField';
import { Button, EmptyState, Screen } from '@/components/ui';
import { AuthHeader } from '@/features/auth/components/AuthHeader';
import { FormError } from '@/features/auth/components/FormError';
import { type ForgotPasswordValues, forgotPasswordSchema } from '@/features/auth/schemas';
import { sendPasswordReset } from '@/features/auth/services/authService';

export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const { control, handleSubmit, getValues } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });
  const reset = useMutation({
    mutationFn: (v: ForgotPasswordValues) => sendPasswordReset(v.email),
  });

  if (reset.isSuccess) {
    return (
      <Screen edges={['bottom']}>
        <EmptyState
          icon="mail-unread-outline"
          title={t('auth.checkEmailTitle')}
          description={t('auth.checkEmailBody', { email: getValues('email') })}
        />
        <Button label={t('auth.backToSignIn')} variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  const submit = handleSubmit((v) => reset.mutate(v));
  return (
    <Screen keyboard edges={['bottom']}>
      <AuthHeader title={t('auth.resetTitle')} subtitle={t('auth.resetSubtitle')} />
      <FormTextField
        control={control}
        name="email"
        label={t('auth.email')}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        onSubmitEditing={submit}
      />
      <FormError error={reset.error} />
      <Button label={t('auth.sendResetLink')} loading={reset.isPending} onPress={submit} />
    </Screen>
  );
}
