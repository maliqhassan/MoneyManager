import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import {
  Button,
  Card,
  ChoiceChips,
  Divider,
  Icon,
  OptionPicker,
  type PickerOption,
  ProgressBar,
  SwitchRow,
  Text,
} from '@/components/ui';
import type { CurrencyCode } from '@/domain/currency/currencies';
import type { CsvError, ParsedCsv } from '@/domain/csv/csv';
import { divideAndRound } from '@/domain/money/decimal';
import type { ImportField } from '@/domain/imports/parsing';
import { detectDateFormats, IMPORT_DATE_FORMATS } from '@/domain/imports/parsing';
import {
  type AmountMode,
  type ImportMapping,
  interpretRecord,
  type PlanRow,
  summarizePlan,
} from '@/domain/imports/plan';
import type { Account } from '@/domain/models';
import { CategoryPickerField } from '@/features/categories/components/CategoryPickerField';
import { useFormatter } from '@/i18n/FormatContext';
import type { ImportBatchSummary, ImportRunResult } from '@/repositories/types';
import { makeStyles } from '@/theme';

import { categoryKey, type collectLabels, type ImportSelections } from '../importPlanner';

const NONE = '__none__';
const PREVIEW_ROWS = 5;
const REVIEW_PREVIEW = 100;
const ERROR_LIST = 50;

const DELIMITER_KEYS: Record<string, 'comma' | 'semicolon' | 'tab' | 'pipe'> = {
  ',': 'comma',
  ';': 'semicolon',
  '\t': 'tab',
  '|': 'pipe',
};

export function useStepStyles() {
  return useStyles();
}

// ------------------------------------------------------------------ file ----

export function FileStep({
  parsed,
  fileName,
  busy,
  incomplete,
  onPick,
  onDismissIncomplete,
}: {
  parsed: ParsedCsv | null;
  fileName: string | null;
  busy: boolean;
  incomplete: readonly ImportBatchSummary[];
  onPick: () => void;
  onDismissIncomplete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const styles = useStyles();
  return (
    <View style={styles.step}>
      {incomplete.map((b) => (
        <Card key={b.id}>
          <View style={styles.body}>
            <View style={styles.row}>
              <Icon name="alert-circle-outline" size={18} tone="warning" />
              <Text variant="bodyStrong" style={styles.flex}>
                {t('dataImport.incomplete.title')}
              </Text>
            </View>
            <Text variant="bodySmall" tone="textSecondary">
              {t('dataImport.incomplete.body', {
                file: b.fileName,
                imported: b.importedCount,
                rows: b.rowCount,
              })}
            </Text>
            <Button
              label={t('dataImport.incomplete.dismiss')}
              variant="ghost"
              size="md"
              onPress={() => onDismissIncomplete(b.id)}
            />
          </View>
        </Card>
      ))}
      <Text variant="body" tone="textSecondary">
        {t('dataImport.file.intro')}
      </Text>
      <Button
        label={parsed ? t('dataImport.file.chooseAnother') : t('dataImport.file.choose')}
        icon="document-text-outline"
        variant={parsed ? 'secondary' : 'primary'}
        loading={busy}
        onPress={onPick}
      />
      {busy ? (
        <Text variant="bodySmall" tone="textSecondary" accessibilityLiveRegion="polite">
          {t('dataImport.file.reading')}
        </Text>
      ) : null}
      {parsed && fileName ? (
        <Card>
          <View style={styles.body}>
            <Text variant="bodyStrong" numberOfLines={2}>
              {fileName}
            </Text>
            <Text variant="bodySmall" tone="textSecondary">
              {t('dataImport.file.summary', {
                rows: parsed.records.length,
                columns: parsed.headers.length,
              })}{' '}
              ·{' '}
              {t('dataImport.file.delimiter', {
                delimiter: t(
                  `dataImport.file.delimiters.${DELIMITER_KEYS[parsed.delimiter] ?? 'comma'}`,
                ),
              })}
            </Text>
            {parsed.records.length === 0 ? (
              <Text variant="body" tone="negative">
                {t('dataImport.file.noRows')}
              </Text>
            ) : (
              <PreviewTable parsed={parsed} />
            )}
            <ParseProblems errors={parsed.errors} />
          </View>
        </Card>
      ) : null}
    </View>
  );
}

function PreviewTable({ parsed }: { parsed: ParsedCsv }) {
  const { t } = useTranslation();
  const styles = useStyles();
  const rows = parsed.records.slice(0, PREVIEW_ROWS);
  return (
    <View style={styles.body}>
      <Text variant="label" tone="textSecondary">
        {t('dataImport.file.preview')}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <View style={styles.tableRow}>
            {parsed.headers.map((h) => (
              <Text
                key={h}
                variant="caption"
                tone="textSecondary"
                style={styles.cell}
                numberOfLines={1}
              >
                {h}
              </Text>
            ))}
          </View>
          {rows.map((r) => (
            <View key={r.line} style={styles.tableRow}>
              {r.cells.map((c, i) => (
                <Text key={i} variant="caption" style={styles.cell} numberOfLines={1}>
                  {c}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function ParseProblems({ errors }: { errors: readonly CsvError[] }) {
  const { t } = useTranslation();
  if (errors.length === 0) return null;
  return (
    <View accessibilityRole="alert">
      <Text variant="bodySmall" tone="warning">
        {t('dataImport.file.problems', { count: errors.length })}
      </Text>
      {errors.slice(0, 10).map((e) => (
        <Text key={`${e.line}:${e.code}`} variant="caption" tone="textSecondary">
          {t('dataImport.file.problemLine', {
            line: e.line,
            reason: t(`dataImport.parseErrors.${e.code}`, {
              expected: e.expected ?? 0,
              found: e.found ?? 0,
            }),
          })}
        </Text>
      ))}
    </View>
  );
}

// --------------------------------------------------------------- columns ----

const FIELDS_BY_MODE: Record<AmountMode, readonly ImportField[]> = {
  signed: ['date', 'amount', 'payee', 'category', 'notes', 'currency', 'account', 'externalId'],
  debit_credit: [
    'date',
    'debit',
    'credit',
    'payee',
    'category',
    'notes',
    'currency',
    'account',
    'externalId',
  ],
  type_column: [
    'date',
    'amount',
    'type',
    'payee',
    'category',
    'notes',
    'currency',
    'account',
    'externalId',
  ],
};

export const REQUIRED_BY_MODE: Record<AmountMode, readonly ImportField[]> = {
  signed: ['date', 'amount'],
  debit_credit: ['date', 'debit', 'credit'],
  type_column: ['date', 'amount', 'type'],
};

export function ColumnsStep({
  headers,
  mapping,
  onChange,
  missing,
}: {
  headers: readonly string[];
  mapping: ImportMapping;
  onChange: (m: ImportMapping) => void;
  missing: readonly ImportField[];
}) {
  const { t } = useTranslation();
  const styles = useStyles();
  const options: PickerOption<string>[] = [
    { value: NONE, label: t('dataImport.columns.notInFile') },
    ...headers.map((h, i) => ({ value: String(i), label: h })),
  ];
  const fields = FIELDS_BY_MODE[mapping.amountMode];
  const used = new Set(
    fields.map((f) => mapping.columns[f]).filter((v): v is number => v !== undefined),
  );
  const ignored = headers.filter((_h, i) => !used.has(i));

  return (
    <View style={styles.step}>
      <Text variant="body" tone="textSecondary">
        {t('dataImport.columns.intro')}
      </Text>
      <ChoiceChips
        label={t('dataImport.columns.amountMode')}
        value={mapping.amountMode}
        onChange={(amountMode) => onChange({ ...mapping, amountMode })}
        choices={(['signed', 'debit_credit', 'type_column'] as const).map((value) => ({
          value,
          label: t(`dataImport.columns.modes.${value}`),
        }))}
      />
      {fields.map((field) => {
        const index = mapping.columns[field];
        return (
          <View key={field} style={styles.group}>
            <OptionPicker
              label={t(`dataImport.columns.fields.${field}`)}
              value={index === undefined ? NONE : String(index)}
              options={options}
              onChange={(value) => {
                const columns = { ...mapping.columns };
                if (value === NONE) delete columns[field];
                else columns[field] = Number(value);
                onChange({ ...mapping, columns });
              }}
            />
            {missing.includes(field) ? (
              <Text variant="bodySmall" tone="negative" accessibilityLiveRegion="polite">
                {t('dataImport.columns.required', {
                  field: t(`dataImport.columns.fields.${field}`),
                })}
              </Text>
            ) : null}
          </View>
        );
      })}
      <Text variant="caption" tone="textSecondary">
        {t('dataImport.columns.externalIdHint')}
      </Text>
      {ignored.length > 0 ? (
        <Text variant="bodySmall" tone="textSecondary">
          {t('dataImport.columns.ignored', { columns: ignored.join(', ') })}
        </Text>
      ) : null}
    </View>
  );
}

// --------------------------------------------------------------- formats ----

export function FormatsStep({
  parsed,
  mapping,
  onChange,
  sampleCurrency,
  timeZone,
}: {
  parsed: ParsedCsv;
  mapping: ImportMapping;
  onChange: (m: ImportMapping) => void;
  sampleCurrency: CurrencyCode;
  timeZone: string;
}) {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const dateIndex = mapping.columns.date;
  const candidates = detectDateFormats(
    parsed.records
      .slice(0, 500)
      .map((r) => (dateIndex === undefined ? '' : (r.cells[dateIndex] ?? ''))),
  );
  const sample = parsed.records
    .slice(0, 3)
    .map((r) => interpretRecord(r, mapping, { timeZone, currencyFor: () => sampleCurrency }));

  return (
    <View style={styles.step}>
      <ChoiceChips
        label={t('dataImport.formats.dateFormat')}
        value={mapping.dateFormat}
        onChange={(dateFormat) => onChange({ ...mapping, dateFormat })}
        choices={IMPORT_DATE_FORMATS.map((value) => ({
          value,
          label: t(`dataImport.formats.dates.${value}`),
        }))}
      />
      <Text variant="bodySmall" tone={candidates.length === 1 ? 'textSecondary' : 'warning'}>
        {candidates.length === 1
          ? t('dataImport.formats.dateDetected', {
              format: t(`dataImport.formats.dates.${candidates[0]!}`),
            })
          : candidates.length > 1
            ? t('dataImport.formats.dateAmbiguous')
            : t('dataImport.formats.dateNone')}
      </Text>
      <ChoiceChips
        label={t('dataImport.formats.decimal')}
        value={mapping.decimal === '.' ? 'dot' : 'comma'}
        onChange={(v) => onChange({ ...mapping, decimal: v === 'dot' ? '.' : ',' })}
        choices={[
          { value: 'dot', label: t('dataImport.formats.decimals.dot') },
          { value: 'comma', label: t('dataImport.formats.decimals.comma') },
        ]}
      />
      {mapping.amountMode === 'signed' ? (
        <ChoiceChips
          label={t('dataImport.formats.negativeMeans')}
          value={mapping.negativeMeans}
          onChange={(negativeMeans) => onChange({ ...mapping, negativeMeans })}
          choices={(['expense', 'income'] as const).map((value) => ({
            value,
            label: t(`dataImport.formats.negative.${value}`),
          }))}
        />
      ) : null}
      {mapping.amountMode === 'type_column' ? (
        <View style={styles.group}>
          <ChoiceChips
            label={t('dataImport.formats.transferRows')}
            value={mapping.transferRows}
            onChange={(transferRows) => onChange({ ...mapping, transferRows })}
            choices={(['skip', 'as_ordinary'] as const).map((value) => ({
              value,
              label: t(`dataImport.formats.transfers.${value}`),
            }))}
          />
          <Text variant="caption" tone="textSecondary">
            {t('dataImport.formats.transferHint')}
          </Text>
        </View>
      ) : null}
      <Card>
        <View style={styles.body}>
          <Text variant="label" tone="textSecondary">
            {t('dataImport.formats.sample')}
          </Text>
          {sample.map((s, i) => (
            <Text key={i} variant="bodySmall" tone={s.ok ? 'text' : 'negative'}>
              {s.ok
                ? t('dataImport.formats.sampleRow', {
                    date: formatter.date(s.candidate.localDate, 'medium'),
                    type: t(`transactions.types.${s.candidate.type}`),
                    amount: formatter.money({
                      amountMinor: s.candidate.amountMinor,
                      currency: s.candidate.currency,
                    }),
                  })
                : t('dataImport.review.errorLine', {
                    line: s.line,
                    reason: t(`dataImport.issues.${s.issue}`),
                  })}
            </Text>
          ))}
        </View>
      </Card>
    </View>
  );
}

// --------------------------------------------------------------- mapping ----

export function MappingStep({
  hasAccountColumn,
  labels,
  accounts,
  selections,
  onChange,
}: {
  hasAccountColumn: boolean;
  labels: ReturnType<typeof collectLabels>;
  accounts: readonly Account[];
  selections: ImportSelections;
  onChange: (s: ImportSelections) => void;
}) {
  const { t } = useTranslation();
  const styles = useStyles();
  const active = accounts.filter((a) => !a.isArchived);
  const accountOptions: PickerOption<string>[] = active.map((a) => ({
    value: a.id,
    label: a.name,
    description: a.currency,
  }));
  const withNone: PickerOption<string>[] = [
    { value: NONE, label: t('dataImport.mapping.chooseAccount') },
    ...accountOptions,
  ];
  if (active.length === 0) {
    return (
      <Text variant="body" tone="negative">
        {t('dataImport.mapping.noActiveAccounts')}
      </Text>
    );
  }

  return (
    <View style={styles.step}>
      {hasAccountColumn ? (
        <View style={styles.group}>
          <Text variant="heading">{t('dataImport.mapping.accountLabels')}</Text>
          {labels.accounts.map((label) => (
            <OptionPicker
              key={label}
              label={t('dataImport.mapping.accountFor', { label })}
              value={selections.accountMap[label] ?? NONE}
              options={withNone}
              onChange={(id) => {
                const accountMap = { ...selections.accountMap };
                if (id === NONE) delete accountMap[label];
                else accountMap[label] = id;
                onChange({ ...selections, accountMap });
              }}
            />
          ))}
          <OptionPicker
            label={t('dataImport.mapping.defaultAccount')}
            value={selections.targetAccountId ?? NONE}
            options={withNone}
            onChange={(id) => onChange({ ...selections, targetAccountId: id === NONE ? null : id })}
          />
        </View>
      ) : (
        <View style={styles.group}>
          <OptionPicker
            label={t('dataImport.mapping.targetAccount')}
            value={selections.targetAccountId ?? NONE}
            options={withNone}
            onChange={(id) => onChange({ ...selections, targetAccountId: id === NONE ? null : id })}
          />
          <Text variant="caption" tone="textSecondary">
            {t('dataImport.mapping.targetHint')}
          </Text>
        </View>
      )}

      {labels.categories.length > 0 ? (
        <View style={styles.group}>
          <Text variant="heading">{t('dataImport.mapping.categories')}</Text>
          {labels.categories.map(({ kind, label }) => {
            const key = categoryKey(kind, label);
            return (
              <CategoryPickerField
                key={key}
                label={`“${label}” · ${t(`categories.${kind}`)}`}
                kind={kind}
                value={selections.categoryMap[key] ?? null}
                onChange={(id) =>
                  onChange({ ...selections, categoryMap: { ...selections.categoryMap, [key]: id } })
                }
              />
            );
          })}
        </View>
      ) : null}

      <View style={styles.group}>
        <CategoryPickerField
          label={t('dataImport.mapping.expenseFallback')}
          kind="expense"
          value={selections.fallback.expense}
          onChange={(id) =>
            onChange({ ...selections, fallback: { ...selections.fallback, expense: id } })
          }
        />
        <CategoryPickerField
          label={t('dataImport.mapping.incomeFallback')}
          kind="income"
          value={selections.fallback.income}
          onChange={(id) =>
            onChange({ ...selections, fallback: { ...selections.fallback, income: id } })
          }
        />
        <Text variant="caption" tone="textSecondary">
          {t('dataImport.mapping.fallbackHint')}
        </Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- review ----

export function ReviewStep({
  plan,
  onToggle,
}: {
  plan: readonly PlanRow[];
  onToggle: (line: number, include: boolean) => void;
}) {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const summary = summarizePlan(plan);
  const duplicates = plan.filter((r) => r.status === 'possible_duplicate');
  const errors = plan.filter((r) => r.status === 'error');
  const included = plan.filter((r) => r.include);
  const describe = (r: PlanRow) =>
    r.candidate
      ? `${formatter.date(r.candidate.localDate, 'medium')} · ${
          r.candidate.payee ?? t(`transactions.types.${r.candidate.type}`)
        } · ${formatter.money(
          {
            amountMinor:
              r.candidate.type === 'expense' ? -r.candidate.amountMinor : r.candidate.amountMinor,
            currency: r.candidate.currency,
          },
          { signDisplay: 'exceptZero' },
        )}`
      : '';

  return (
    <View style={styles.step}>
      <Card>
        <View style={styles.body}>
          <View style={styles.row}>
            <Icon name="information-circle-outline" size={18} tone="textSecondary" />
            <Text variant="bodyStrong" style={styles.flex}>
              {t('dataImport.review.nothingYet')}
            </Text>
          </View>
          <Text variant="body">{t('dataImport.review.toImport', { count: summary.toImport })}</Text>
          {summary.alreadyImported > 0 ? (
            <Text variant="bodySmall" tone="textSecondary">
              {t('dataImport.review.alreadyImported', { count: summary.alreadyImported })}
            </Text>
          ) : null}
          {summary.possibleDuplicates > 0 ? (
            <Text variant="bodySmall" tone="warning">
              {t('dataImport.review.possibleDuplicates', { count: summary.possibleDuplicates })}
            </Text>
          ) : null}
          {summary.errors > 0 ? (
            <Text variant="bodySmall" tone="negative">
              {t('dataImport.review.errors', { count: summary.errors })}
            </Text>
          ) : null}
          <Text variant="caption" tone="textMuted">
            {t('dataImport.review.chunkNote')}
          </Text>
        </View>
      </Card>

      {duplicates.length > 0 ? (
        <View style={styles.group}>
          <Text variant="heading">{t('dataImport.review.duplicatesTitle')}</Text>
          <Text variant="bodySmall" tone="textSecondary">
            {t('dataImport.review.duplicatesHint')}
          </Text>
          <Card padding="none">
            {duplicates.map((r, i) => (
              <View key={r.line}>
                {i > 0 ? <Divider inset={16} /> : null}
                <SwitchRow
                  label={describe(r)}
                  hint={`${t('dataImport.review.include')} · ${t('dataImport.review.line', { line: r.line })}`}
                  value={r.include}
                  onValueChange={(on) => onToggle(r.line, on)}
                />
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      {errors.length > 0 ? (
        <View style={styles.group}>
          <Text variant="heading">{t('dataImport.review.errorsTitle')}</Text>
          <Card>
            <View style={styles.body}>
              {errors.slice(0, ERROR_LIST).map((r) => (
                <Text key={r.line} variant="bodySmall" tone="textSecondary">
                  {t('dataImport.review.errorLine', {
                    line: r.line,
                    reason: t(`dataImport.issues.${r.issue ?? 'invalid_amount'}`),
                  })}
                </Text>
              ))}
              {errors.length > ERROR_LIST ? (
                <Text variant="caption" tone="textMuted">
                  {t('dataImport.review.moreErrors', { count: errors.length - ERROR_LIST })}
                </Text>
              ) : null}
            </View>
          </Card>
        </View>
      ) : null}

      {included.length > 0 ? (
        <View style={styles.group}>
          <Text variant="heading">{t('dataImport.review.previewTitle')}</Text>
          <Card>
            <View style={styles.body}>
              {included.slice(0, REVIEW_PREVIEW).map((r) => (
                <Text key={r.line} variant="bodySmall" numberOfLines={2}>
                  {describe(r)}
                </Text>
              ))}
              {included.length > REVIEW_PREVIEW ? (
                <Text variant="caption" tone="textMuted">
                  {t('dataImport.review.previewMore', {
                    shown: REVIEW_PREVIEW,
                    total: included.length,
                  })}
                </Text>
              ) : null}
            </View>
          </Card>
        </View>
      ) : null}
    </View>
  );
}

// -------------------------------------------------------- importing/done ----

export function ImportingStep({ done, total }: { done: number; total: number }) {
  const { t } = useTranslation();
  const styles = useStyles();
  const bp = total > 0 ? Number(divideAndRound(BigInt(done) * 10_000n, BigInt(total), 'floor')) : 0;
  return (
    <View style={styles.step}>
      <Text variant="heading">{t('dataImport.importing.title')}</Text>
      <ProgressBar valueBasisPoints={bp} accessibilityLabel={t('dataImport.importing.title')} />
      <Text variant="body" accessibilityLiveRegion="polite">
        {t('dataImport.importing.progress', { done, total })}
      </Text>
      <Text variant="bodySmall" tone="textSecondary">
        {t('dataImport.importing.keepOpen')}
      </Text>
    </View>
  );
}

export function DoneStep({
  result,
  rejected,
  duplicatesSkipped,
  isOnline,
}: {
  result: ImportRunResult;
  rejected: number;
  duplicatesSkipped: number;
  isOnline: boolean;
}) {
  const { t } = useTranslation();
  const styles = useStyles();
  const failed = result.status === 'failed';
  const skipped = result.skipped + duplicatesSkipped;
  return (
    <View style={styles.step}>
      <View style={styles.row}>
        <Icon
          name={failed ? 'alert-circle-outline' : 'checkmark-circle-outline'}
          size={24}
          tone={failed ? 'warning' : 'positive'}
        />
        <Text variant="heading" style={styles.flex} accessibilityRole="header">
          {failed ? t('dataImport.done.failedTitle') : t('dataImport.done.title')}
        </Text>
      </View>
      <Text variant="body">{t('dataImport.done.imported', { count: result.imported })}</Text>
      {skipped > 0 ? (
        <Text variant="bodySmall" tone="textSecondary">
          {t('dataImport.done.skipped', { count: skipped })}
        </Text>
      ) : null}
      {rejected > 0 ? (
        <Text variant="bodySmall" tone="textSecondary">
          {t('dataImport.done.rejected', { count: rejected })}
        </Text>
      ) : null}
      {failed ? (
        <Text variant="body" tone="warning" accessibilityRole="alert">
          {t('dataImport.done.failedBody', { imported: result.imported })}
        </Text>
      ) : null}
      {!isOnline && result.imported > 0 ? (
        <Text variant="bodySmall" tone="textSecondary">
          {t('dataImport.done.offline')}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  step: { gap: t.spacing.lg },
  body: { gap: t.spacing.sm },
  group: { gap: t.spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
  flex: { flex: 1 },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border,
    paddingVertical: t.spacing.xxs,
  },
  cell: { width: 120, paddingEnd: t.spacing.sm },
}));
