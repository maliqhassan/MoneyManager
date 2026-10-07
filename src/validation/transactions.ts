import { z } from 'zod';

import { canSplit } from '@/domain/transactions/transactions';

import {
  calendarDateSchema,
  ianaTimeZoneSchema,
  optionalTextSchema,
  positiveAmountMinorSchema,
} from './common';

/**
 * Write inputs for transactions and transfers. Amounts are POSITIVE
 * magnitudes in minor units; the domain applies the sign by type.
 * Referential rules (account active, category kind, archived state) are
 * checked by the repository inside the write transaction.
 */

const idSchema = z.string().trim().min(1, { message: 'validation.required' });
const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'validation.invalidTime' });

export const splitInputSchema = z.object({
  categoryId: idSchema,
  amountMinor: positiveAmountMinorSchema,
  notes: optionalTextSchema(500).default(null),
});

export const tagNameSchema = z
  .string()
  .trim()
  .min(1, { message: 'validation.required' })
  .max(50, { message: 'validation.tooLong' });

export const transactionInputSchema = z
  .object({
    type: z.enum(['expense', 'income', 'refund']),
    accountId: idSchema,
    amountMinor: positiveAmountMinorSchema,
    localDate: calendarDateSchema,
    localTime: localTimeSchema,
    timeZone: ianaTimeZoneSchema,
    payee: optionalTextSchema(200).default(null),
    notes: optionalTextSchema(1000).default(null),
    categoryId: idSchema.nullable().default(null),
    splits: z.array(splitInputSchema).max(20).default([]),
    tagNames: z.array(tagNameSchema).max(20).default([]),
    refundOfTransactionId: idSchema.nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (v.splits.length > 0) {
      if (!canSplit(v.type)) {
        ctx.addIssue({
          code: 'custom',
          path: ['splits'],
          message: 'transactions.errors.splitNotAllowed',
        });
        return;
      }
      if (v.splits.length < 2) {
        ctx.addIssue({
          code: 'custom',
          path: ['splits'],
          message: 'transactions.errors.splitTooFew',
        });
      }
      const total = v.splits.reduce((acc, s) => acc + s.amountMinor, 0);
      if (total !== v.amountMinor) {
        ctx.addIssue({
          code: 'custom',
          path: ['splits'],
          message: 'transactions.errors.splitMismatch',
        });
      }
    } else if (!v.categoryId) {
      ctx.addIssue({
        code: 'custom',
        path: ['categoryId'],
        message: 'transactions.errors.categoryRequired',
      });
    }
    if (v.refundOfTransactionId && v.type !== 'refund') {
      ctx.addIssue({
        code: 'custom',
        path: ['refundOfTransactionId'],
        message: 'transactions.errors.refundLinkOnlyForRefunds',
      });
    }
  });
export type TransactionInput = z.input<typeof transactionInputSchema>;
export type ValidTransactionInput = z.output<typeof transactionInputSchema>;

export const transferInputSchema = z
  .object({
    fromAccountId: idSchema,
    toAccountId: idSchema,
    amountMinor: positiveAmountMinorSchema,
    /** Amount that arrived, in the destination currency (cross-currency only). */
    receivedAmountMinor: positiveAmountMinorSchema.nullable().default(null),
    localDate: calendarDateSchema,
    localTime: localTimeSchema,
    timeZone: ianaTimeZoneSchema,
    notes: optionalTextSchema(1000).default(null),
  })
  .refine((v) => v.fromAccountId !== v.toAccountId, {
    path: ['toAccountId'],
    message: 'transactions.errors.sameAccount',
  });
export type TransferInput = z.input<typeof transferInputSchema>;
export type ValidTransferInput = z.output<typeof transferInputSchema>;

export const RECEIPT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'application/pdf',
] as const;
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

export const receiptFileSchema = z.object({
  localUri: z.string().min(1),
  mimeType: z.enum(RECEIPT_MIME_TYPES, { message: 'transactions.errors.receiptType' }),
  sizeBytes: z
    .number()
    .int()
    .min(1, { message: 'transactions.errors.receiptEmpty' })
    .max(MAX_RECEIPT_BYTES, { message: 'transactions.errors.receiptTooLarge' }),
  fileName: z.string().trim().min(1).max(255),
});
export type ReceiptFile = z.input<typeof receiptFileSchema>;
