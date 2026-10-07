import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, TextInput, View } from 'react-native';

import { BottomSheet, Button, Icon, Text } from '@/components/ui';
import { useFormatter } from '@/i18n/FormatContext';
import type { TransactionListItem } from '@/repositories/types';
import { makeStyles, useTheme } from '@/theme';

import { useRefundCandidates, useTransaction } from '../hooks';

/** Optional link from a refund to the purchase it reverses. */
export function RefundLinkField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const formatter = useFormatter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const linked = useTransaction(value ?? '');
  const candidates = useRefundCandidates(open ? query : '');

  const describe = (tx: {
    payee: string | null;
    amountMinor: number;
    currency: TransactionListItem['currency'];
    localDate: string;
  }) =>
    `${tx.payee ?? t('transactions.types.expense')} · ${formatter.money({ amountMinor: tx.amountMinor, currency: tx.currency })} · ${formatter.date(tx.localDate)}`;

  return (
    <View style={styles.container}>
      <Text variant="label" tone="textSecondary">
        {t('transactions.fields.originalTransaction')}
      </Text>
      {value && linked.data ? (
        <View style={styles.linked}>
          <Icon name="link-outline" size={18} tone="primary" />
          <Text variant="body" style={styles.linkedText} numberOfLines={2}>
            {describe(linked.data.transaction)}
          </Text>
          <Button
            label={t('transactions.fields.clearOriginal')}
            variant="ghost"
            size="md"
            fullWidth={false}
            onPress={() => onChange(null)}
          />
        </View>
      ) : (
        <>
          <Button
            label={t('transactions.fields.chooseOriginal')}
            icon="link-outline"
            variant="secondary"
            size="md"
            onPress={() => setOpen(true)}
          />
          <Text variant="bodySmall" tone="textMuted">
            {t('transactions.fields.originalOptional')}
          </Text>
        </>
      )}

      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={t('transactions.fields.chooseOriginal')}
        closeLabel={t('common.close')}
      >
        <View style={styles.searchBox}>
          <Icon name="search" size={18} tone="textMuted" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('transactions.searchPlaceholder')}
            placeholderTextColor={theme.colors.textMuted}
            accessibilityLabel={t('common.search')}
            style={[styles.searchInput, { color: theme.colors.text }]}
          />
        </View>
        <FlatList
          data={candidates.data ?? []}
          keyExtractor={(item) => item.id}
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text variant="bodySmall" tone="textSecondary" style={styles.empty}>
              {query ? t('common.noResults', { query }) : t('transactions.emptyTitle')}
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={describe(item)}
              onPress={() => {
                onChange(item.id);
                setOpen(false);
              }}
              style={({ pressed }) => [
                styles.option,
                pressed && { backgroundColor: theme.colors.surfaceMuted },
              ]}
            >
              <Text variant="body" numberOfLines={2}>
                {describe(item)}
              </Text>
            </Pressable>
          )}
        />
      </BottomSheet>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: { gap: t.spacing.xs },
  linked: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
  linkedText: { flex: 1 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surfaceMuted,
    paddingHorizontal: t.spacing.md,
    minHeight: t.minTouchTarget,
  },
  searchInput: { flex: 1, ...t.typography.body, paddingVertical: t.spacing.sm },
  list: { maxHeight: 420 },
  option: {
    minHeight: t.minTouchTarget + 8,
    justifyContent: 'center',
    paddingHorizontal: t.spacing.sm,
    borderRadius: t.radius.md,
  },
  empty: { padding: t.spacing.lg, textAlign: 'center' },
}));
