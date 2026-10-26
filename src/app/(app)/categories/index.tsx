import { type Href, router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, View } from 'react-native';

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
import { normalizeSearchText } from '@/domain/text/search';
import { CategoryIcon } from '@/features/categories/components/CategoryIcon';
import { useCategories, useCategoryMutations, useCategoryName } from '@/features/categories/hooks';
import { makeStyles, useTheme } from '@/theme';

/**
 * Category management: expense / income, one card per category with its
 * subcategories, search, reorder, add a subcategory in place, and archived
 * categories (restorable) at the end.
 */
export default function CategoriesScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const name = useCategoryName();
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [search, setSearch] = useState('');
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

  const q = normalizeSearchText(search);
  const matches = (c: Category) => !q || normalizeSearchText(name(c)).includes(q);
  const visibleParents = parents.filter((p) => matches(p) || childrenOf(p.id).some(matches));

  const openEdit = (c: Category) => router.push(`/categories/${c.id}/edit` as Href);
  const addSub = (parent: Category) =>
    router.push(`/categories/new?kind=${kind}&parentId=${parent.id}` as Href);

  const reorder = (c: Category, siblings: Category[]) => {
    if (q) return null; // order is meaningless in a filtered list
    const index = siblings.findIndex((s) => s.id === c.id);
    return (
      <>
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
      </>
    );
  };

  const parentCard = (parent: Category) => {
    const kids = childrenOf(parent.id);
    const shownKids = q && !matches(parent) ? kids.filter(matches) : kids;
    return (
      <Card key={parent.id} padding="none">
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${name(parent)}, ${t('categories.subcategoryCount', { count: kids.length })}`}
            onPress={() => openEdit(parent)}
            style={({ pressed }) => [
              styles.rowMain,
              pressed && { backgroundColor: theme.colors.surfaceMuted },
            ]}
          >
            <CategoryIcon icon={parent.icon} color={parent.color} size={40} />
            <View style={styles.flex}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {name(parent)}
              </Text>
              <Text variant="caption" tone="textSecondary">
                {t('categories.subcategoryCount', { count: kids.length })}
              </Text>
            </View>
          </Pressable>
          {reorder(parent, parents)}
        </View>
        {shownKids.length > 0 ? <Divider inset={16} /> : null}
        {shownKids.map((child) => (
          <View key={child.id} style={[styles.row, styles.childRow]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={name(child)}
              onPress={() => openEdit(child)}
              style={({ pressed }) => [
                styles.rowMain,
                styles.childMain,
                pressed && { backgroundColor: theme.colors.surfaceMuted },
              ]}
            >
              <CategoryIcon icon={child.icon} color={child.color} size={28} />
              <Text variant="body" style={styles.flex} numberOfLines={1}>
                {name(child)}
              </Text>
            </Pressable>
            {reorder(child, kids)}
          </View>
        ))}
        {!q ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t('categories.addSubcategory')}: ${name(parent)}`}
            onPress={() => addSub(parent)}
            style={({ pressed }) => [
              styles.addSub,
              pressed && { backgroundColor: theme.colors.surfaceMuted },
            ]}
          >
            <Icon name="add-circle-outline" size={20} tone="primary" />
            <Text variant="label" tone="primary">
              {t('categories.addSubcategory')}
            </Text>
          </Pressable>
        ) : null}
      </Card>
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
      <View style={styles.searchBox}>
        <Icon name="search" size={18} tone="textMuted" />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={t('categories.search')}
          placeholderTextColor={theme.colors.textMuted}
          accessibilityLabel={t('categories.search')}
          autoCorrect={false}
          style={[styles.searchInput, { color: theme.colors.text }]}
        />
        {search ? (
          <IconButton
            icon="close-circle"
            size={18}
            tone="textMuted"
            accessibilityLabel={t('common.close')}
            onPress={() => setSearch('')}
          />
        ) : null}
      </View>

      {query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isLoading ? (
        <View style={styles.skeletons}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={72} radius={16} />
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
      ) : visibleParents.length === 0 ? (
        <EmptyState
          icon="search-outline"
          title={t('common.noResults', { query: search })}
          actionLabel={t('categories.new')}
          onAction={() => router.push(`/categories/new?kind=${kind}` as Href)}
        />
      ) : (
        <View style={styles.cards}>{visibleParents.map(parentCard)}</View>
      )}

      {archived.length > 0 && !q ? (
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
  cards: { gap: t.spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', paddingEnd: t.spacing.xs },
  childRow: { paddingStart: t.spacing.xl },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
    minHeight: t.minTouchTarget + 8,
    paddingHorizontal: t.spacing.lg,
  },
  childMain: { minHeight: t.minTouchTarget, paddingStart: t.spacing.md },
  addSub: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    minHeight: t.minTouchTarget,
    paddingHorizontal: t.spacing.lg,
    marginStart: t.spacing.xl,
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
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
    paddingStart: t.spacing.md,
    minHeight: t.minTouchTarget,
  },
  searchInput: { flex: 1, ...t.typography.body, paddingVertical: t.spacing.sm },
  skeletons: { gap: t.spacing.sm },
}));
