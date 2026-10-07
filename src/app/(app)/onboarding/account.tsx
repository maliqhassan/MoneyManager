import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button, Card, LoadingState, MoneyText, Text } from '@/components/ui';
import { AccountForm } from '@/features/accounts/components/AccountForm';
import { AccountIcon } from '@/features/accounts/components/AccountIcon';
import { defaultFormValues, toAccountInput } from '@/features/accounts/formSchema';
import { useAccount, useAccountMutations } from '@/features/accounts/hooks/useAccounts';
import { OnboardingScreen } from '@/features/onboarding/components/OnboardingScreen';
import { useOnboarding } from '@/features/onboarding/useOnboarding';
import { useFormatter } from '@/i18n/FormatContext';
import { showToast } from '@/stores/toastStore';
import { makeStyles } from '@/theme';

export default function AccountStep() {
  const { t } = useTranslation();
  const { progress, advance, goBack, setAccount } = useOnboarding();
  const formatter = useFormatter();
  const { create } = useAccountMutations();
  if (!progress) return null;

  const onBack = () => goBack('preferences');

  if (progress.accountId) {
    return (
      <CreatedAccount
        accountId={progress.accountId}
        onBack={onBack}
        onContinue={() => advance('account')}
      />
    );
  }

  return (
    <OnboardingScreen
      step="account"
      title={t('onboarding.account.title')}
      subtitle={t('onboarding.account.subtitle')}
      onBack={onBack}
      keyboard
    >
      <AccountForm
        initialValues={defaultFormValues('checking', progress.draft.currency)}
        showAdvanced={false}
        submitLabel={t('accounts.add')}
        submitError={create.error}
        onSubmit={async (values) => {
          const account = await create.mutateAsync(
            toAccountInput(values, formatter.separators.decimal, formatter.today()),
          );
          setAccount(account.id);
          showToast(t('accounts.toast.created', { name: account.name }));
          advance('account');
        }}
        secondaryAction={{ label: t('common.skip'), onPress: () => advance('account') }}
      />
    </OnboardingScreen>
  );
}

function CreatedAccount({
  accountId,
  onBack,
  onContinue,
}: {
  accountId: string;
  onBack: () => void;
  onContinue: () => void;
}) {
  const { t } = useTranslation();
  const styles = useStyles();
  const { data, isLoading } = useAccount(accountId);

  return (
    <OnboardingScreen
      step="account"
      title={data ? t('onboarding.account.created', { name: data.account.name }) : ''}
      subtitle={t('onboarding.account.createdBody')}
      onBack={onBack}
      footer={<Button label={t('common.continue')} onPress={onContinue} />}
    >
      {isLoading ? <LoadingState /> : null}
      {data ? (
        <Card>
          <View style={styles.row}>
            <AccountIcon
              type={data.account.type}
              icon={data.account.icon}
              color={data.account.color}
            />
            <View style={styles.body}>
              <Text variant="bodyStrong">{data.account.name}</Text>
              <Text variant="bodySmall" tone="textSecondary">
                {t(`accounts.types.${data.account.type}`)}
              </Text>
            </View>
            <MoneyText value={data.balance} />
          </View>
        </Card>
      ) : null}
    </OnboardingScreen>
  );
}

const useStyles = makeStyles((t) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md },
  body: { flex: 1, gap: t.spacing.xxs },
}));
