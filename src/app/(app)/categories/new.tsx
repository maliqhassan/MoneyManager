import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { LoadingState, Screen } from '@/components/ui';
import type { CategoryKind } from '@/domain/enums';
import { CategoryForm } from '@/features/categories/components/CategoryForm';
import { useCategories, useCategoryMutations } from '@/features/categories/hooks';
import { showToast } from '@/stores/toastStore';
import { ACCOUNT_COLORS } from '@/theme';

/** Create a category or subcategory (works offline; queued for sync). */
export default function NewCategoryScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ kind?: string; parentId?: string }>();
  const kind: CategoryKind = params.kind === 'income' ? 'income' : 'expense';
  const parents = useCategories({ kind });
  const { create } = useCategoryMutations();
  if (parents.isLoading) return <LoadingState />;

  return (
    <Screen keyboard>
      <Stack.Screen
        options={{ title: params.parentId ? t('categories.newSubcategory') : t('categories.new') }}
      />
      <CategoryForm
        kind={kind}
        parents={(parents.data ?? []).filter((c) => !c.parentId)}
        submitLabel={t('common.save')}
        initialValues={{
          name: '',
          parentId: params.parentId ?? null,
          icon: 'pricetag-outline',
          color: ACCOUNT_COLORS[0],
        }}
        onSubmit={async (values) => {
          const created = await create.mutateAsync({ ...values, kind });
          showToast(t('categories.toast.created', { name: created.name }));
          router.back();
        }}
      />
    </Screen>
  );
}
