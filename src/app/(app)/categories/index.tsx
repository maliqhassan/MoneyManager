import { type Href, router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import {
  Card,
  ChoiceChips,
  Divider,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  Screen,
  Skeleton,
  Text,
} from '@/components/ui';
import type { CategoryKind } from '@/domain/enums';
import type { Category } from '@/domain/models';
import { CategoryIcon } from '@/features/categories/components/CategoryIcon';
import { useCategories, useCategoryMutations, useCategoryName } from '@/features/categories/hooks';
import { makeStyles, useTheme } from '@/theme';

/** Category management: expense/income, parents with subcategories, reorder, archived. */
export default function CategoriesScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const name = useCategoryName();
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [showArchived, setShowArchived] = useState(false);
  const query = useCategories({ kind, includeArchived: true });
  const { move } = useCategoryMutations();

  const { parents, childrenOf, archived } = useMemo(() => {
    const all = query.data ?? [];
    const active = all.filter((c) => !c.isArchived);
    return {
      parents: active.filter((c) => !c.parentId),
      childrenOf: (id: string) => active.filter((c) => c.parentId === id),
      archived: all.filter((c) => c.isArchived),
    };
  }, [query.data]);

  const openEdit = (c: Category) => router.push(`/categories/${c.id}/edit` as Href);

  const row = (c: Category, siblings: Category[], indent: boolean) => {
    const index = siblings.findIndex((s) => s.id === c.id);
    return (
      <View style={[styles.row, indent && styles.indent]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={name(c)}
          onPress={() => openEdit(c)}
          style={({ pressed }) => [
            styles.rowMain,
            pressed && { backgroundColor: theme.colors.surfaceMuted },
          ]}
        >
          <CategoryIcon icon={c.icon} color={c.color} size={indent ? 28 : 36} />
          <Text variant={indent ? 'body' : 'bodyStrong'} style={styles.flex} numberOfLines={1}>
            {name(c)}
          </Text>
        </Pressable>
        <IconButton
          icon="chevron-up"
          size={18}
          tone="textSecondary"
          accessibilityLabel={t('categories.moveUp', { name: name(c) })}
          disabled={index <= 0}
          onPress={() => move.mutate({ id: c.id, direction: 'up' })}
        />
        <IconButton
          icon="chevron-down"
          size={18}
          tone="textSecondary"
          accessibilityLabel={t('categories.moveDown', { name: name(c) })}
          disabled={index >= siblings.length - 1}
          onPress={() => move.mutate({ id: c.id, direction: 'down' })}
        />
      </View>
    );
  };

  return (
    <Screen>
      <Stack.Screen
        options={{
          headerRight: () => (
            <IconButton
              icon="add"
              accessibilityLabel={t('categories.new')}
              onPress={() => router.push(`/categories/new?kind=${kind}` as Href)}
            />
          ),
        }}
      />
      <ChoiceChips
        value={kind}
        onChange={setKind}
        choices={[
          { value: 'expense', label: t('categories.expense') },
          { value: 'income', label: t('categories.income') },
        ]}
      />

      {query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isLoading ? (
        <View style={styles.skeletons}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={52} radius={12} />
          ))}
        </View>
      ) : parents.length === 0 && archived.length === 0 ? (
        <EmptyState
          icon="pricetags-outline"
          title={t('categories.emptyTitle')}
          description={t('categories.emptyBody')}
          actionLabel={t('categories.new')}
          onAction={() => router.push(`/categories/new?kind=${kind}` as Href)}
        />
      ) : (
        <Card padding="none">
          {parents.map((parent, i) => {
            const kids = childrenOf(parent.id);
            return (
              <View key={parent.id}>
                {i > 0 ? <Divider /> : null}
                {row(parent, parents, false)}
                {kids.map((child) => (
                  <View key={child.id}>{row(child, kids, true)}</View>
                ))}
              </View>
            );
          })}
        </Card>
      )}

      {archived.length > 0 ? (
        <View style={styles.section}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showArchived }}
            onPress={() => setShowArchived((v) => !v)}
            style={styles.archivedHeader}
          >
            <Text variant="heading">
              {t('categories.archivedSection', { count: archived.length })}
            </Text>
            <Icon name={showArchived ? 'chevron-up' : 'chevron-down'} tone="textSecondary" />
          </Pressable>
          {showArchived ? (
            <Card padding="none">
              {archived.map((c, i) => (
                <View key={c.id}>
                  {i > 0 ? <Divider inset={16} /> : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${name(c)}, ${t('categories.archived')}`}
                    onPress={() => openEdit(c)}
                    style={({ pressed }) => [
                      styles.rowMain,
                      styles.archivedRow,
                      pressed && { backgroundColor: theme.colors.surfaceMuted },
                    ]}
                  >
                    <CategoryIcon icon={c.icon} color={c.color} size={28} />
                    <Text variant="body" tone="textSecondary" style={styles.flex}>
                      {name(c)}
                    </Text>
                    <Icon name="chevron-forward" size={18} tone="textMuted" />
                  </Pressable>
                </View>
              ))}
            </Card>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  row: { flexDirection: 'row', alignItems: 'center', paddingEnd: t.spacing.xs },
  indent: { paddingStart: t.spacing.xl },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
    minHeight: t.minTouchTarget + 4,
    paddingHorizontal: t.spacing.lg,
  },
  archivedRow: { paddingEnd: t.spacing.lg },
  flex: { flex: 1 },
  section: { gap: t.spacing.sm },
  archivedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: t.minTouchTarget,
  },
  skeletons: { gap: t.spacing.sm },
}));
