import { type CurrencyCode, getMinorUnits } from '../currency/currencies';
import { MAX_ABS_AMOUNT_MINOR } from './money';
import { type NumberSeparators, parseMoneyInput, type ParseMoneyResult } from './parse';

/**
 * Amount entry with an on-screen keypad that can add and subtract
 * ("120+35.50−10"). The expression is kept as text in the user's decimal
 * separator and evaluated exactly in integer minor units — never floats.
 */

export type KeypadKey =
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | 'decimal'
  | 'plus'
  | 'minus'
  | 'backspace'
  | 'clear';

export const PLUS = '+';
export const MINUS = '−'; // U+2212, as shown on the keypad

/** Longest operand in digits (well inside the stored amount range). */
const MAX_OPERAND_DIGITS = 13;

const isOperator = (c: string | undefined) => c === PLUS || c === MINUS;

/** The operand currently being typed (after the last operator). */
function currentOperand(expr: string): string {
  const i = Math.max(expr.lastIndexOf(PLUS), expr.lastIndexOf(MINUS));
  return expr.slice(i + 1);
}

/** Applies one key press. Invalid presses leave the expression unchanged. */
export function pressKey(
  expr: string,
  key: KeypadKey,
  currency: CurrencyCode,
  decimal: string,
): string {
  const minorUnits = getMinorUnits(currency);
  const operand = currentOperand(expr);
  switch (key) {
    case 'clear':
      return '';
    case 'backspace':
      return [...expr].slice(0, -1).join('');
    case 'plus':
    case 'minus': {
      const op = key === 'plus' ? PLUS : MINUS;
      if (expr === '') return '';
      if (isOperator(expr.at(-1))) return expr.slice(0, -1) + op;
      if (operand.endsWith(decimal)) return expr.slice(0, -decimal.length) + op;
      return expr + op;
    }
    case 'decimal': {
      if (minorUnits === 0 || operand.includes(decimal)) return expr;
      return expr + (operand === '' ? `0${decimal}` : decimal);
    }
    default: {
      const [whole = '', fraction] = operand.split(decimal);
      if (fraction !== undefined) {
        return fraction.length >= minorUnits ? expr : expr + key;
      }
      if (whole === '0') return expr.slice(0, -1) + key; // no leading zeros
      return whole.length >= MAX_OPERAND_DIGITS ? expr : expr + key;
    }
  }
}

/** True when the expression contains + or − (the result differs from what is typed). */
export function hasOperation(expr: string): boolean {
  return [...expr].some((c, i) => i > 0 && isOperator(c));
}

/**
 * Exact value of the expression. A trailing operator or decimal separator is
 * ignored, so the result can be shown live while typing.
 */
export function evaluateExpression(
  expr: string,
  currency: CurrencyCode,
  separators: NumberSeparators,
): ParseMoneyResult {
  let text = expr;
  while (isOperator(text.at(-1)) || text.endsWith(separators.decimal)) {
    text = isOperator(text.at(-1)) ? text.slice(0, -1) : text.slice(0, -separators.decimal.length);
  }
  if (text === '') return { ok: false, error: 'empty' };

  let total = 0n;
  let sign = 1n;
  let operand = '';
  const flush = (): ParseMoneyResult | null => {
    const parsed = parseMoneyInput(operand, currency, { decimal: separators.decimal, group: '' });
    if (!parsed.ok) return parsed;
    total += sign * BigInt(parsed.value.amountMinor);
    return null;
  };
  for (const c of text) {
    if (isOperator(c) && operand !== '') {
      const failed = flush();
      if (failed) return failed;
      sign = c === PLUS ? 1n : -1n;
      operand = '';
    } else {
      operand += c;
    }
  }
  const failed = flush();
  if (failed) return failed;
  if (total > BigInt(MAX_ABS_AMOUNT_MINOR) || total < -BigInt(MAX_ABS_AMOUNT_MINOR)) {
    return { ok: false, error: 'out_of_range' };
  }
  return { ok: true, value: { amountMinor: Number(total), currency } };
}
