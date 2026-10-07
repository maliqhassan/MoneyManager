import { z } from 'zod';

import { ACCOUNT_TYPES, CATEGORY_KINDS } from '@/domain/enums';

import {
  amountMinorSchema,
  calendarDateSchema,
  currencyCodeSchema,
  hexColorSchema,
  nameSchema,
  nonNegativeAmountMinorSchema,
  optionalTextSchema,
  uuidSchema,
} from './common';

/**
 * Input schemas for creating/updating entities through repositories.
 * Repositories validate every write with these before touching SQLite, so
 * malformed data can never reach the local database or the sync queue.
 *
 * IMPORTANT: Zod 4 applies `.default()` values even inside `.partial()`.
 * Update schemas are therefore derived from a base shape WITHOUT defaults;
 * defaults are added only to create schemas. Otherwise a partial update
 * would silently reset unrelated fields.
 */

// ---- Accounts -------------------------------------------------------------

const accountShape = z.object({
  name: nameSchema,
  type: z.enum(ACCOUNT_TYPES),
  currency: currencyCodeSchema,
  openingBalanceMinor: amountMinorSchema,
  openingBalanceDate: calendarDateSchema,
  creditLimitMinor: nonNegativeAmountMinorSchema.nullable(),
  institution: optionalTextSchema(100),
  color: hexColorSchema.nullable(),
  icon: z.string().max(64).nullable(),
  notes: optionalTextSchema(1000),
  includeInTotals: z.boolean(),
  sortOrder: z.number().int().min(0),
});

export const accountInputSchema = accountShape.extend({
  creditLimitMinor: accountShape.shape.creditLimitMinor.default(null),
  institution: accountShape.shape.institution.default(null),
  color: accountShape.shape.color.default(null),
  icon: accountShape.shape.icon.default(null),
  notes: accountShape.shape.notes.default(null),
  includeInTotals: accountShape.shape.includeInTotals.default(true),
  sortOrder: accountShape.shape.sortOrder.default(0),
});
export type AccountInput = z.input<typeof accountInputSchema>;
export type ValidAccountInput = z.output<typeof accountInputSchema>;

export const accountUpdateSchema = accountShape
  .omit({ currency: true }) // changing an account's currency would corrupt its history
  .extend({ isArchived: z.boolean() })
  .partial();
export type AccountUpdate = z.input<typeof accountUpdateSchema>;

// ---- Categories -----------------------------------------------------------

const categoryShape = z.object({
  parentId: uuidSchema.nullable(),
  name: nameSchema,
  kind: z.enum(CATEGORY_KINDS),
  icon: z.string().max(64).nullable(),
  color: hexColorSchema.nullable(),
  sortOrder: z.number().int().min(0),
});

export const categoryInputSchema = categoryShape.extend({
  parentId: categoryShape.shape.parentId.default(null),
  icon: categoryShape.shape.icon.default(null),
  color: categoryShape.shape.color.default(null),
  sortOrder: categoryShape.shape.sortOrder.default(0),
});
export type CategoryInput = z.input<typeof categoryInputSchema>;
export type ValidCategoryInput = z.output<typeof categoryInputSchema>;

export const categoryUpdateSchema = categoryShape.extend({ isArchived: z.boolean() }).partial();
export type CategoryUpdate = z.input<typeof categoryUpdateSchema>;
