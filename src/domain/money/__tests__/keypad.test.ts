import { evaluateExpression, hasOperation, type KeypadKey, MINUS, PLUS, pressKey } from '../keypad';

const EN = { decimal: '.', group: ',' };
const DE = { decimal: ',', group: '.' };

/** Types a sequence of keys from an empty expression. */
function type(keys: string, currency = 'USD' as const, decimal = '.') {
  const map: Record<string, KeypadKey> = {
    '.': 'decimal',
    ',': 'decimal',
    '+': 'plus',
    '-': 'minus',
    '<': 'backspace',
    C: 'clear',
  };
  let expr = '';
  for (const k of keys) expr = pressKey(expr, map[k] ?? (k as KeypadKey), currency, decimal);
  return expr;
}

describe('pressKey', () => {
  it('builds amounts digit by digit, without leading zeros', () => {
    expect(type('1250')).toBe('1250');
    expect(type('0007')).toBe('7');
    expect(type('0')).toBe('0');
  });

  it('allows one decimal separator per number and no more decimals than the currency has', () => {
    expect(type('12.505')).toBe('12.50');
    expect(type('1..5')).toBe('1.5');
    expect(type('.5')).toBe('0.5');
    expect(type('12,5', 'USD', ',')).toBe('12,5');
    // Zero-decimal currencies have no decimal key.
    expect(type('150.5', 'JPY' as never)).toBe('1505');
  });

  it('adds and subtracts; a second operator replaces the first', () => {
    expect(type('120+35.5-10')).toBe(`120${PLUS}35.5${MINUS}10`);
    expect(type('5+-2')).toBe(`5${MINUS}2`);
    expect(type('+5')).toBe('5'); // cannot start with an operator
    expect(type('5.+2')).toBe(`5${PLUS}2`); // dangling separator dropped
    expect(type('1.5+.25')).toBe(`1.5${PLUS}0.25`);
  });

  it('backspace removes one character; clear empties', () => {
    expect(type('12+3<<')).toBe('12');
    expect(type('12+3C')).toBe('');
    expect(type('<')).toBe('');
  });

  it('caps very long numbers', () => {
    expect(type('12345678901234567')).toBe('1234567890123');
  });
});

describe('evaluateExpression', () => {
  it('evaluates exactly in minor units', () => {
    expect(evaluateExpression(`120${PLUS}35.50${MINUS}10`, 'USD', EN)).toEqual({
      ok: true,
      value: { amountMinor: 145_50, currency: 'USD' },
    });
    // 0.1 + 0.2 is exactly 0.30 here.
    expect(evaluateExpression(`0.1${PLUS}0.2`, 'USD', EN)).toEqual({
      ok: true,
      value: { amountMinor: 30, currency: 'USD' },
    });
    expect(evaluateExpression(`12,5${PLUS}1`, 'EUR', DE)).toEqual({
      ok: true,
      value: { amountMinor: 13_50, currency: 'EUR' },
    });
  });

  it('ignores a trailing operator or separator while typing', () => {
    expect(evaluateExpression(`12${PLUS}`, 'USD', EN)).toMatchObject({
      ok: true,
      value: { amountMinor: 12_00 },
    });
    expect(evaluateExpression('12.', 'USD', EN)).toMatchObject({ value: { amountMinor: 12_00 } });
  });

  it('can be zero or negative (the form decides what it accepts)', () => {
    expect(evaluateExpression(`5${MINUS}5`, 'USD', EN)).toMatchObject({
      value: { amountMinor: 0 },
    });
    expect(evaluateExpression(`5${MINUS}7`, 'USD', EN)).toMatchObject({
      value: { amountMinor: -2_00 },
    });
  });

  it('reports empty, invalid and out-of-range input', () => {
    expect(evaluateExpression('', 'USD', EN)).toEqual({ ok: false, error: 'empty' });
    expect(evaluateExpression(PLUS, 'USD', EN)).toEqual({ ok: false, error: 'empty' });
    expect(evaluateExpression('1.2.3', 'USD', EN)).toEqual({ ok: false, error: 'invalid' });
    expect(evaluateExpression(`1${PLUS}1.234`, 'USD', EN)).toEqual({
      ok: false,
      error: 'too_many_decimals',
    });
    expect(evaluateExpression(`9999999999999${PLUS}9999999999999`, 'USD', EN)).toEqual({
      ok: false,
      error: 'out_of_range',
    });
  });
});

describe('hasOperation', () => {
  it('is true only when + or − appears after the first number', () => {
    expect(hasOperation('12')).toBe(false);
    expect(hasOperation(`12${PLUS}3`)).toBe(true);
    expect(hasOperation(`12${MINUS}`)).toBe(true);
    expect(hasOperation('')).toBe(false);
  });
});
