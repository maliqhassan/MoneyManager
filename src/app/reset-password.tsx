import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { FormTextField } from '@/components/form/FormTextField';
import { Button, Screen, Text } from '@/components/ui';
import { AuthHeader } from '@/features/auth/components/AuthHeader';
import { FormError } from '@/features/auth/components/FormError';
import { type NewPasswordValues, newPasswordSchema } from '@/features/auth/schemas';
import { updatePassword } from '@/features/auth/services/authService';

/** Reached after opening a password-recovery link (PASSWORD_RECOVERY event). */
export default function ResetPasswordScreen() {
  const { t } = useTranslation();
  const { control, handleSubmit } = useForm<NewPasswordValues>({
    resolver: zodResolver(newPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });
  const mutation = useMutation({
    mutationFn: (v: NewPasswordValues) => updatePassword(v.password),
  });

  return (
    <Screen keyboard edges={['top', 'bottom']}>
      <AuthHeader title={t('auth.setNewPasswordTitle')} />
      <FormTextField
        control={control}
        name="password"
        label={t('auth.newPassword')}
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
      />
      <FormError error={mutation.error} />
      {mutation.isSuccess ? <Text tone="positive">{t('auth.passwordUpdated')}</Text> : null}
      <Button
        label={t('auth.updatePassword')}
        loading={mutation.isPending}
        onPress={handleSubmit((v) => mutation.mutate(v))}
      />
    </Screen>
  );
}
