import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type Href, router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button, ErrorState, LoadingState, Screen, Text } from '@/components/ui';
import { parseCsv } from '@/domain/csv/csv';
import {
  detectDateFormats,
  detectDecimalSeparator,
  type ImportField,
  suggestMapping,
} from '@/domain/imports/parsing';
import { summarizePlan } from '@/domain/imports/plan';
import { useAccounts } from '@/features/accounts/hooks/useAccounts';
import { useCategories, useCategoryName } from '@/features/categories/hooks';
import {
  ColumnsStep,
  DoneStep,
  FileStep,
  FormatsStep,
  ImportingStep,
  MappingStep,
  REQUIRED_BY_MODE,
  ReviewStep,
} from '@/features/data/components/ImportSteps';
import { autoMatch, collectLabels, planImport, rowsToImport } from '@/features/data/importPlanner';
import { EMPTY_MAPPING, IMPORT_STEPS, useImportStore } from '@/features/data/importStore';
import { useFormatter } from '@/i18n/FormatContext';
import { useRepositories } from '@/providers/DataProvider';
import { discardPickedCopy, pickCsvFile, readCsvText } from '@/services/data/dataFiles';
import { useSyncStore } from '@/stores/syncStore';
import { makeStyles } from '@/theme';

const VISIBLE_STEPS = ['file', 'columns', 'formats', 'mapping', 'review'] as const;

/**
 * Guided CSV import. Nothing is written until the user confirms the review
 * step; rows then become normal transactions through the repositories
 * (validated, offline-first, synced through the outbox).
 */
export default function ImportScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const repos = useRepositories();
  const queryClient = useQueryClient();
  const categoryName = useCategoryName();
  const isOnline = useSyncStore((s) => s.isOnline);
  const state = useImportStore();
  const accounts = useAccounts({ includeArchived: true });
  const categories = useCategories({ includeArchived: true });
  const incomplete = useQuery({
    queryKey: ['import_batches', 'incomplete'],
    queryFn: () => repos.imports.incompleteBatches(),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [missing, setMissing] = useState<ImportField[]>([]);
  const tz = formatter.settings.timeZone;

  // A fresh import each time the screen opens.
  useEffect(() => {
    useImportStore.getState().reset();
    return () => {
      const { file } = useImportStore.getState();
      if (file) discardPickedCopy(file);
    };
  }, []);

  const activeAccounts = useMemo(
    () => (accounts.data ?? []).filter((a) => !a.isArchived),
    [accounts.data],
  );
  const labels = useMemo(
    () =>
      state.parsed
        ? collectLabels(state.parsed.records, state.mapping, tz, formatter.settings.baseCurrency)
        : { accounts: [], categories: [] },
    [state.parsed, state.mapping, tz, formatter.settings.baseCurrency],
  );

  if (accounts.isLoading || categories.isLoading) return <LoadingState />;
  const loadError = accounts.error ?? categories.error;
  if (loadError) {
    return (
      <Screen>
        <ErrorState
          error={loadError}
          onRetry={() => void Promise.all([accounts.refetch(), categories.refetch()])}
        />
      </Screen>
    );
  }

  const stepIndex = VISIBLE_STEPS.indexOf(state.step as (typeof VISIBLE_STEPS)[number]);
  const go = (step: (typeof IMPORT_STEPS)[number]) => {
    setError(null);
    setMissing([]);
    state.set({ step });
  };

  const pick = async () => {
    setError(null);
    try {
      const file = await pickCsvFile();
      if (!file) return;
      setBusy(true);
      if (state.file) discardPickedCopy(state.file);
      const text = await readCsvText(file);
      // Let the "Reading…" state render before parsing a large file.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const parsed = parseCsv(text);
      const columns = suggestMapping(parsed.headers);
      const values = (index: number | undefined) =>
        parsed.records
          .slice(0, 500)
          .map((r) => (index === undefined ? '' : (r.cells[index] ?? '')));
      const dates = detectDateFormats(values(columns.date));
      const amountValues = [
        ...values(columns.amount),
        ...values(columns.debit),
        ...values(columns.credit),
      ];
      const decimals = detectDecimalSeparator(amountValues);
      const preferred = formatter.separators.decimal === ',' ? ',' : '.';
      state.set({
        file,
        parsed,
        plan: null,
        mapping: {
          ...EMPTY_MAPPING,
          columns,
          amountMode:
            columns.debit !== undefined &&
            columns.credit !== undefined &&
            columns.amount === undefined
              ? 'debit_credit'
              : 'signed',
          dateFormat: dates.length === 1 ? dates[0]! : null,
          decimal: decimals.length === 1 ? decimals[0]! : preferred,
        },
      });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const nextFromColumns = () => {
    const required = REQUIRED_BY_MODE[state.mapping.amountMode];
    const absent = required.filter((f) => state.mapping.columns[f] === undefined);
    if (absent.length > 0) {
      setMissing(absent);
      return;
    }
    go('formats');
  };

  const enterMapping = () => {
    const matched = autoMatch(labels, accounts.data ?? [], categories.data ?? [], categoryName);
    const bySystemKey = (key: string) =>
      (categories.data ?? []).find((c) => c.systemKey === key && !c.isArchived)?.id ?? null;
    state.set({
      selections: {
        targetAccountId:
          state.selections.targetAccountId ??
          (activeAccounts.length === 1 ? activeAccounts[0]!.id : null),
        accountMap: { ...matched.accountMap, ...state.selections.accountMap },
        categoryMap: { ...matched.categoryMap, ...state.selections.categoryMap },
        fallback: {
          expense: state.selections.fallback.expense ?? bySystemKey('other_expense'),
          income: state.selections.fallback.income ?? bySystemKey('other_income'),
        },
      },
    });
    go('mapping');
  };

  const buildReview = async () => {
    if (!state.parsed) return;
    setBusy(true);
    setError(null);
    try {
      const plan = await planImport({
        repos,
        records: state.parsed.records,
        mapping: state.mapping,
        selections: state.selections,
        accounts: accounts.data ?? [],
        categories: categories.data ?? [],
        timeZone: tz,
      });
      state.set({ plan });
      go('review');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!state.plan || !state.file) return;
    const rows = rowsToImport(state.plan, tz);
    const summary = summarizePlan(state.plan);
    state.set({ step: 'importing', progress: { done: 0, total: rows.length } });
    let result;
    try {
      result = await repos.imports.run(
        {
          fileName: state.file.name,
          accountId:
            state.mapping.columns.account === undefined ? state.selections.targetAccountId : null,
          rowCount: summary.total,
          duplicateCount: summary.alreadyImported + summary.possibleDuplicates,
          errorCount: summary.errors,
          columnMapping: {
            columns: state.mapping.columns,
            amountMode: state.mapping.amountMode,
            negativeMeans: state.mapping.negativeMeans,
            dateFormat: state.mapping.dateFormat,
            decimal: state.mapping.decimal,
          },
        },
        rows,
        (progress) => useImportStore.getState().set({ progress }),
      );
    } catch (e) {
      // Nothing was committed for the batch row itself; stay on the review.
      setError(e);
      state.set({ step: 'review', progress: null });
      return;
    }
    discardPickedCopy(state.file);
    void queryClient.invalidateQueries({ queryKey: ['import_batches'] });
    state.set({ step: 'done', result, file: null });
  };

  const summary = state.plan ? summarizePlan(state.plan) : null;

  return (
    <Screen keyboard>
      <Stack.Screen options={{ title: t('dataImport.title') }} />
      {stepIndex >= 0 ? (
        <Text variant="bodySmall" tone="textSecondary" accessibilityRole="header">
          {t('dataImport.stepOf', {
            step: stepIndex + 1,
            total: VISIBLE_STEPS.length,
            name: t(`dataImport.steps.${state.step}`),
          })}
        </Text>
      ) : null}

      {state.step === 'file' ? (
        <FileStep
          parsed={state.parsed}
          fileName={state.file?.name ?? null}
          busy={busy}
          incomplete={incomplete.data ?? []}
          onPick={() => void pick()}
          onDismissIncomplete={(id) =>
            void repos.imports.dismissBatch(id).then(() => incomplete.refetch())
          }
        />
      ) : null}
      {state.step === 'columns' && state.parsed ? (
        <ColumnsStep
          headers={state.parsed.headers}
          mapping={state.mapping}
          onChange={(mapping) => state.set({ mapping })}
          missing={missing}
        />
      ) : null}
      {state.step === 'formats' && state.parsed ? (
        <FormatsStep
          parsed={state.parsed}
          mapping={state.mapping}
          onChange={(mapping) => state.set({ mapping })}
          sampleCurrency={
            activeAccounts.find((a) => a.id === state.selections.targetAccountId)?.currency ??
            activeAccounts[0]?.currency ??
            formatter.settings.baseCurrency
          }
          timeZone={tz}
        />
      ) : null}
      {state.step === 'mapping' ? (
        <MappingStep
          hasAccountColumn={state.mapping.columns.account !== undefined}
          labels={labels}
          accounts={accounts.data ?? []}
          selections={state.selections}
          onChange={(selections) => state.set({ selections })}
        />
      ) : null}
      {state.step === 'review' && state.plan ? (
        <ReviewStep
          plan={state.plan}
          onToggle={(line, include) =>
            state.set({
              plan: state.plan!.map((r) => (r.line === line ? { ...r, include } : r)),
            })
          }
        />
      ) : null}
      {state.step === 'importing' && state.progress ? (
        <ImportingStep done={state.progress.done} total={state.progress.total} />
      ) : null}
      {state.step === 'done' && state.result && summary ? (
        <DoneStep
          result={state.result}
          rejected={summary.errors}
          duplicatesSkipped={
            summary.alreadyImported +
            (state.plan ?? []).filter((r) => r.status === 'possible_duplicate' && !r.include).length
          }
          isOnline={isOnline}
        />
      ) : null}

      {error ? <ErrorState error={error} /> : null}

      <View style={styles.actions}>
        {state.step === 'file' ? (
          <Button
            label={t('dataImport.next')}
            disabled={!state.parsed || state.parsed.records.length === 0}
            onPress={() => go('columns')}
          />
        ) : null}
        {state.step === 'columns' ? (
          <Button label={t('dataImport.next')} onPress={nextFromColumns} />
        ) : null}
        {state.step === 'formats' ? (
          <Button
            label={t('dataImport.next')}
            disabled={state.mapping.dateFormat === null && !isYearFirst(state)}
            onPress={enterMapping}
          />
        ) : null}
        {state.step === 'mapping' ? (
          <Button
            label={t('dataImport.next')}
            loading={busy}
            disabled={activeAccounts.length === 0}
            onPress={() => void buildReview()}
          />
        ) : null}
        {state.step === 'review' && summary ? (
          summary.toImport > 0 ? (
            <Button
              label={t('dataImport.review.confirm', { count: summary.toImport })}
              icon="checkmark-done-outline"
              onPress={() => void confirmImport()}
            />
          ) : (
            <Text variant="body" tone="textSecondary">
              {t('dataImport.review.nothingToImport')}
            </Text>
          )
        ) : null}
        {state.step === 'done' ? (
          <>
            <Button
              label={t('dataImport.done.viewTransactions')}
              onPress={() => {
                state.reset();
                router.navigate('/transactions' as Href);
              }}
            />
            <Button
              label={t('dataImport.done.another')}
              variant="secondary"
              onPress={() => {
                state.reset();
                void incomplete.refetch();
              }}
            />
          </>
        ) : null}
        {stepIndex > 0 ? (
          <Button
            label={t('dataImport.back')}
            variant="ghost"
            disabled={busy}
            onPress={() => go(VISIBLE_STEPS[stepIndex - 1]!)}
          />
        ) : null}
        {state.step !== 'importing' && state.step !== 'done' ? (
          <Button label={t('dataImport.cancel')} variant="ghost" onPress={() => router.back()} />
        ) : null}
      </View>
    </Screen>
  );
}

/** Year-first dates need no format choice. */
function isYearFirst(state: ReturnType<typeof useImportStore.getState>): boolean {
  const index = state.mapping.columns.date;
  if (!state.parsed || index === undefined) return false;
  const formats = detectDateFormats(
    state.parsed.records.slice(0, 500).map((r) => r.cells[index] ?? ''),
  );
  return formats.length === 1 && formats[0] === 'YMD';
}

const useStyles = makeStyles((t) => ({
  actions: { gap: t.spacing.sm, marginTop: t.spacing.md },
}));
