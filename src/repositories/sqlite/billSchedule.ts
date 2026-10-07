import type { RecurrenceFrequency } from '@/domain/enums';
import { compareDates } from '@/domain/dates/calendar';
import { dueDateAfter } from '@/domain/planning/bills';
import type { SqlExecutor } from '@/database/types';

import { type RepositoryContext, updateSynced } from './shared';

interface ScheduleRow {
  id: string;
  anchor_date: string | null;
  next_due_date: string;
  end_date: string | null;
  frequency: RecurrenceFrequency;
  interval: number;
  is_active: number;
}

async function readSchedule(tx: SqlExecutor, ctx: RepositoryContext, billId: string) {
  return tx.getFirst<ScheduleRow>(
    `SELECT id, anchor_date, next_due_date, end_date, frequency, interval, is_active
     FROM bills WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [billId, ctx.userId],
  );
}

async function settledDates(tx: SqlExecutor, billId: string): Promise<Set<string>> {
  const rows = await tx.getAll<{ due_date: string }>(
    `SELECT due_date FROM bill_payments WHERE bill_id = ? AND deleted_at IS NULL`,
    [billId],
  );
  return new Set(rows.map((r) => r.due_date));
}

/**
 * Moves a bill's next due date past `settledDueDate` to the first occurrence
 * that is not already paid or skipped. When the schedule has ended (end
 * date), the bill becomes inactive — its history stays.
 */
export async function advanceBill(
  tx: SqlExecutor,
  ctx: RepositoryContext,
  billId: string,
  settledDueDate: string,
): Promise<void> {
  const bill = await readSchedule(tx, ctx, billId);
  if (!bill) return;
  const settled = await settledDates(tx, billId);
  const schedule = {
    anchorDate: bill.anchor_date ?? bill.next_due_date,
    frequency: bill.frequency,
    interval: bill.interval,
    endDate: bill.end_date,
  };
  let next = dueDateAfter(schedule, settledDueDate);
  while (next && settled.has(next)) next = dueDateAfter(schedule, next);
  await updateSynced(
    tx,
    ctx,
    'bills',
    billId,
    next ? { next_due_date: next } : { next_due_date: settledDueDate, is_active: 0 },
  );
}

/**
 * Marks a payment's due date as unpaid again: the bill's next due date moves
 * back to it if it is earlier, and a bill that had finished its schedule
 * becomes active again.
 */
export async function reopenDueDate(
  tx: SqlExecutor,
  ctx: RepositoryContext,
  billId: string,
  dueDate: string,
): Promise<void> {
  const bill = await readSchedule(tx, ctx, billId);
  if (!bill) return;
  // Inactive because its schedule ran out (not archived by the user).
  const finished =
    bill.is_active === 0 &&
    bill.end_date !== null &&
    dueDateAfter(
      {
        anchorDate: bill.anchor_date ?? bill.next_due_date,
        frequency: bill.frequency,
        interval: bill.interval,
        endDate: bill.end_date,
      },
      bill.next_due_date,
    ) === null;
  if (compareDates(dueDate, bill.next_due_date) < 0 || finished) {
    await updateSynced(tx, ctx, 'bills', billId, {
      next_due_date: dueDate,
      ...(finished ? { is_active: 1 } : {}),
    });
  }
}

/**
 * Called when a transaction is deleted: any bill payment made by it is
 * removed and that due date becomes unpaid again, so a bill can never show
 * as paid without the transaction that paid it.
 */
export async function releaseBillPayments(
  tx: SqlExecutor,
  ctx: RepositoryContext,
  transactionId: string,
): Promise<void> {
  const payments = await tx.getAll<{ id: string; bill_id: string; due_date: string }>(
    `SELECT id, bill_id, due_date FROM bill_payments
     WHERE transaction_id = ? AND user_id = ? AND deleted_at IS NULL`,
    [transactionId, ctx.userId],
  );
  for (const p of payments) {
    await updateSynced(tx, ctx, 'bill_payments', p.id, { deleted_at: ctx.now() }, 'delete');
    await reopenDueDate(tx, ctx, p.bill_id, p.due_date);
  }
}
