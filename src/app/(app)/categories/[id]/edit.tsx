import { type Href, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';

import { Button, EmptyState, ErrorState, LoadingState, Screen, Text } from '@/components/ui';
import { FormError } from '@/features/auth/components/FormError';
import { CategoryForm } from '@/features/categories/components/CategoryForm';
import {
  resolveCategoryColor,
  resolveCategoryIcon,
} from '@/features/categories/components/CategoryIcon';
import {
  useCategories,
  useCategory,
  useCategoryMutations,
  useCategoryName,
} from '@/features/categories/hooks';
import { showToast } from '@/stores/toastStore';
import { makeStyles } from '@/theme';

/**
 * Edit / archive / restore / delete a category. Categories with history can
 * only be archived — past transactions keep showing them.
 */
export default function EditCategoryScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const name = useCategoryName();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useCategory(id);
  const parents = useCategories({ kind: query.data?.category.kind });
  const { update, setArchived, remove } = useCategoryMutations();

  if (query.isLoading) return <LoadingState />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) {
    return (
      <Screen>
        <EmptyState icon="help-circle-outline" title={t('common.noResults', { query: '' })} />
      </Screen>
    );
  }
  const { category, usage } = query.data;
  const display = name(category);
  const unused =
    usage.transactionCount === 0 && usage.ruleCount === 0 && usage.activeChildCount === 0;

  const archive = () =>
    Alert.alert(
      t('categories.archiveTitle', { name: display }),
      usage.activeChildCount > 0
        ? t('categories.archiveParentBody', { count: usage.activeChildCount })
        : t('categories.archiveBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.archive'),
          onPress: () =>
            setArchived.mutate(
              { id, archived: true },
              { onSuccess: () => showToast(t('categories.toast.archived', { name: display })) },
            ),
        },
      ],
    );

  const destroy = () =>
    Alert.alert(t('categories.deleteTitle', { name: display }), t('categories.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () =>
          remove.mutate(id, {
            onSuccess: () => {
              showToast(t('categories.toast.deleted', { name: display }));
              router.back();
            },
          }),
      },
    ]);

  return (
    <Screen keyboard>
      <CategoryForm
        kind={category.kind}
        selfId={category.id}
        parents={(parents.data ?? []).filter((c) => !c.parentId)}
        submitLabel={t('common.saveChanges')}
        initialValues={{
          name: display,
          parentId: category.parentId,
          icon: resolveCategoryIcon(category.icon),
          color: resolveCategoryColor(category.color),
        }}
        onSubmit={async (values) => {
          // Keep the seeded English name (and therefore translations) if unchanged.
          const nameChanged = values.name !== display;
          await update.mutateAsync({
            id,
            patch: {
              ...(nameChanged ? { name: values.name } : {}),
              parentId: values.parentId,
              icon: values.icon,
              color: values.color,
            },
          });
          showToast(t('categories.toast.saved'));
          router.back();
        }}
      />

      <View style={styles.actions}>
        {!category.parentId && !category.isArchived ? (
          <Button
            label={t('categories.addSubcategory')}
            icon="add"
            variant="secondary"
            onPress={() =>
              router.push(`/categories/new?kind=${category.kind}&parentId=${category.id}` as Href)
            }
          />
        ) : null}
        {category.isArchived ? (
          <Button
            label={t('common.restore')}
            icon="arrow-undo-outline"
            variant="secondary"
            loading={setArchived.isPending}
            onPress={() =>
              setArchived.mutate(
                { id, archived: false },
                { onSuccess: () => showToast(t('categories.toast.restored', { name: display })) },
              )
            }
          />
        ) : (
          <Button
            label={t('common.archive')}
            icon="archive-outline"
            variant="secondary"
            loading={setArchived.isPending}
            onPress={archive}
          />
        )}
        {unused ? (
          <Button
            label={t('common.delete')}
            icon="trash-outline"
            variant="destructive"
            loading={remove.isPending}
            onPress={destroy}
          />
        ) : (
          <Text variant="bodySmall" tone="textMuted" align="center">
            {t('categories.errors.inUse')}
          </Text>
        )}
        <FormError error={setArchived.error ?? remove.error} />
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  actions: { gap: t.spacing.sm, marginTop: t.spacing.lg },
}));
