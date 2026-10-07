import type { CurrencyCode } from '@/domain/currency/currencies';
import type { CategoryKind, RuleMatchField, RuleMatchType, TransactionType } from '@/domain/enums';
import type {
  Attachment,
  Category,
  CategoryRule,
  Tag,
  Transaction,
  TransactionSplit,
} from '@/domain/models';

import { toBool } from './shared';

/** Row → model mappers for Phase 2 tables (snake_case SQLite → camelCase domain). */

export interface SyncedRow {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
}

export const synced = (r: SyncedRow) => ({
  id: r.id,
  userId: r.user_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
  version: r.version,
});

export interface CategoryRow extends SyncedRow {
  parent_id: string | null;
  name: string;
  kind: CategoryKind;
  icon: string | null;
  color: string | null;
  system_key: string | null;
  is_archived: number;
  sort_order: number;
}

export function toCategory(r: CategoryRow): Category {
  return {
    ...synced(r),
    parentId: r.parent_id,
    name: r.name,
    kind: r.kind,
    icon: r.icon,
    color: r.color,
    systemKey: r.system_key,
    isArchived: toBool(r.is_archived),
    sortOrder: r.sort_order,
  };
}

export interface TagRow extends SyncedRow {
  name: string;
  color: string | null;
}

export const toTag = (r: TagRow): Tag => ({ ...synced(r), name: r.name, color: r.color });

export interface RuleRow extends SyncedRow {
  name: string | null;
  match_field: RuleMatchField;
  match_type: RuleMatchType;
  pattern: string;
  category_id: string;
  merchant_id: string | null;
  priority: number;
  is_enabled: number;
}

export const toRule = (r: RuleRow): CategoryRule => ({
  ...synced(r),
  name: r.name,
  matchField: r.match_field,
  matchType: r.match_type,
  pattern: r.pattern,
  categoryId: r.category_id,
  merchantId: r.merchant_id,
  priority: r.priority,
  isEnabled: toBool(r.is_enabled),
});

export interface TransactionRow extends SyncedRow {
  account_id: string;
  type: TransactionType;
  amount_minor: number;
  currency: CurrencyCode;
  original_amount_minor: number;
  original_currency: CurrencyCode;
  fx_rate: string;
  base_currency: CurrencyCode;
  base_amount_minor: number;
  base_fx_rate: string;
  base_fx_rate_date: string;
  base_fx_source: string;
  category_id: string | null;
  merchant_id: string | null;
  payee: string | null;
  notes: string | null;
  occurred_at: string;
  local_date: string;
  time_zone: string;
  is_split: number;
  transfer_id: string | null;
  refund_of_transaction_id: string | null;
  recurring_transaction_id: string | null;
  import_batch_id: string | null;
  import_hash: string | null;
  merchant_key: string | null;
}

export function toTransaction(r: TransactionRow): Transaction {
  return {
    ...synced(r),
    accountId: r.account_id,
    type: r.type,
    amountMinor: r.amount_minor,
    currency: r.currency,
    originalAmountMinor: r.original_amount_minor,
    originalCurrency: r.original_currency,
    fxRate: r.fx_rate,
    baseCurrency: r.base_currency,
    baseAmountMinor: r.base_amount_minor,
    baseFxRate: r.base_fx_rate,
    baseFxRateDate: r.base_fx_rate_date,
    baseFxSource: r.base_fx_source,
    categoryId: r.category_id,
    merchantId: r.merchant_id,
    payee: r.payee,
    notes: r.notes,
    occurredAt: r.occurred_at,
    localDate: r.local_date,
    timeZone: r.time_zone,
    isSplit: toBool(r.is_split),
    transferId: r.transfer_id,
    refundOfTransactionId: r.refund_of_transaction_id,
    recurringTransactionId: r.recurring_transaction_id,
    importBatchId: r.import_batch_id,
    importHash: r.import_hash,
    merchantKey: r.merchant_key,
  };
}

export interface SplitRow extends SyncedRow {
  transaction_id: string;
  category_id: string | null;
  amount_minor: number;
  base_amount_minor: number;
  notes: string | null;
  sort_order: number;
}

export const toSplit = (r: SplitRow): TransactionSplit => ({
  ...synced(r),
  transactionId: r.transaction_id,
  categoryId: r.category_id,
  amountMinor: r.amount_minor,
  baseAmountMinor: r.base_amount_minor,
  notes: r.notes,
  sortOrder: r.sort_order,
});

export interface AttachmentRow extends SyncedRow {
  transaction_id: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  file_name: string;
  local_uri: string | null;
  upload_status: 'pending' | 'uploaded' | 'failed';
}

export const toAttachment = (r: AttachmentRow): Attachment => ({
  ...synced(r),
  transactionId: r.transaction_id,
  storagePath: r.storage_path,
  mimeType: r.mime_type,
  sizeBytes: r.size_bytes,
  fileName: r.file_name,
  localUri: r.local_uri,
  uploadStatus: r.upload_status,
});
