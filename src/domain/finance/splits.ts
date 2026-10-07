export type SplitValidationError =
  'too_few_splits' | 'zero_split' | 'sign_mismatch' | 'sum_mismatch' | 'invalid_amount';

/**
 * A split transaction is valid when it has at least two parts, every part is
 * non-zero with the same sign as the parent, and the parts sum exactly to the
 * parent amount.
 */
export function validateSplits(
  parentAmountMinor: number,
  splitAmountsMinor: readonly number[],
): { ok: true } | { ok: false; error: SplitValidationError; differenceMinor?: number } {
  if (splitAmountsMinor.length < 2) return { ok: false, error: 'too_few_splits' };
  if (splitAmountsMinor.some((a) => !Number.isSafeInteger(a))) {
    return { ok: false, error: 'invalid_amount' };
  }
  if (splitAmountsMinor.some((a) => a === 0)) return { ok: false, error: 'zero_split' };
  const parentSign = Math.sign(parentAmountMinor);
  if (splitAmountsMinor.some((a) => Math.sign(a) !== parentSign)) {
    return { ok: false, error: 'sign_mismatch' };
  }
  const total = splitAmountsMinor.reduce((acc, a) => acc + a, 0);
  if (total !== parentAmountMinor) {
    return { ok: false, error: 'sum_mismatch', differenceMinor: parentAmountMinor - total };
  }
  return { ok: true };
}
