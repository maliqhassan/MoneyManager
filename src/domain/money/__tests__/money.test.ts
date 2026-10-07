import {
  abs,
  add,
  allocate,
  AmountOutOfRangeError,
  compare,
  CurrencyMismatchError,
  equals,
  isNegative,
  isPositive,
  isZero,
  MAX_ABS_AMOUNT_MINOR,
  max,
  min,
  money,
  multiply,
  negate,
  subtract,
  sum,
  toMajorString,
  zero,
} from '../money';

describe('money construction', () => {
  it('represents USD 10.50 as 1050 minor units', () => {
    expect(money(1050, 'USD')).toEqual({ amountMinor: 1050, currency: 'USD' });
  });

  it('rejects fractional minor units', () => {
    expect(() => money(10.5, 'USD')).toThrow(AmountOutOfRangeError);
  });

  it('rejects amounts beyond the allowed range', () => {
    expect(() => money(MAX_ABS_AMOUNT_MINOR + 1, 'USD')).toThrow(AmountOutOfRangeError);
    expect(money(MAX_ABS_AMOUNT_MINOR, 'USD').amountMinor).toBe(MAX_ABS_AMOUNT_MINOR);
  });

  it('normalises negative zero', () => {
    expect(Object.is(negate(zero('USD')).amountMinor, 0)).toBe(true);
  });
});

describe('money arithmetic', () => {
  it('adds without floating-point drift (0.1 + 0.2)', () => {
    expect(add(money(10, 'USD'), money(20, 'USD')).amountMinor).toBe(30);
  });

  it('subtracts', () => {
    expect(subtract(money(1000, 'EUR'), money(1250, 'EUR')).amountMinor).toBe(-250);
  });

  it('refuses to mix currencies', () => {
    expect(() => add(money(1, 'USD'), money(1, 'EUR'))).toThrow(CurrencyMismatchError);
    expect(() => compare(money(1, 'USD'), money(1, 'EUR'))).toThrow(CurrencyMismatchError);
  });

  it('sums a list and returns zero for an empty list', () => {
    expect(sum([money(1, 'GBP'), money(2, 'GBP'), money(-5, 'GBP')], 'GBP').amountMinor).toBe(-2);
    expect(sum([], 'GBP')).toEqual(zero('GBP'));
  });

  it('compares, min/max, predicates', () => {
    const a = money(100, 'USD');
    const b = money(-50, 'USD');
    expect(compare(a, b)).toBe(1);
    expect(compare(b, a)).toBe(-1);
    expect(compare(a, a)).toBe(0);
    expect(max(a, b)).toBe(a);
    expect(min(a, b)).toBe(b);
    expect(isPositive(a)).toBe(true);
    expect(isNegative(b)).toBe(true);
    expect(isZero(zero('USD'))).toBe(true);
    expect(abs(b).amountMinor).toBe(50);
    expect(equals(a, money(100, 'USD'))).toBe(true);
    expect(equals(a, money(100, 'CAD'))).toBe(false);
  });

  it('multiplies by an exact decimal factor with rounding', () => {
    expect(multiply(money(1999, 'USD'), '0.15').amountMinor).toBe(300); // 299.85 → 300
    expect(multiply(money(-1999, 'USD'), '0.15').amountMinor).toBe(-300);
    expect(multiply(money(1005, 'USD'), '0.5', 'half-even').amountMinor).toBe(502); // 502.5 → 502
  });
});

describe('allocate', () => {
  it('splits evenly without losing cents', () => {
    const parts = allocate(money(1000, 'USD'), [1, 1, 1]);
    expect(parts.map((p) => p.amountMinor)).toEqual([334, 333, 333]);
    expect(parts.reduce((acc, p) => acc + p.amountMinor, 0)).toBe(1000);
  });

  it('handles negative amounts symmetrically', () => {
    const parts = allocate(money(-1000, 'USD'), [1, 1, 1]);
    expect(parts.map((p) => p.amountMinor)).toEqual([-334, -333, -333]);
  });

  it('respects ratios and largest remainders', () => {
    expect(allocate(money(100, 'USD'), [70, 20, 10]).map((p) => p.amountMinor)).toEqual([
      70, 20, 10,
    ]);
    // 1.5 / 3.5: equal remainders, the tie goes to the earlier part.
    expect(allocate(money(5, 'USD'), [3, 7]).map((p) => p.amountMinor)).toEqual([2, 3]);
    // 0.3 / 2.7 / 7.0: the larger remainder (0.7 vs 0.3) receives the leftover unit.
    expect(allocate(money(10, 'USD'), [3, 27, 70]).map((p) => p.amountMinor)).toEqual([0, 3, 7]);
    expect(allocate(money(10, 'JPY'), [0, 1]).map((p) => p.amountMinor)).toEqual([0, 10]);
  });

  it('validates ratios', () => {
    expect(() => allocate(money(1, 'USD'), [])).toThrow(RangeError);
    expect(() => allocate(money(1, 'USD'), [0, 0])).toThrow(RangeError);
    expect(() => allocate(money(1, 'USD'), [1.5])).toThrow(RangeError);
    expect(() => allocate(money(1, 'USD'), [-1, 2])).toThrow(RangeError);
  });
});

describe('toMajorString', () => {
  it.each([
    [1050, 'USD', '10.50'],
    [-5, 'USD', '-0.05'],
    [0, 'USD', '0.00'],
    [1000, 'JPY', '1000'],
    [1250, 'KWD', '1.250'],
  ] as const)('%d %s → %s', (amount, currency, expected) => {
    expect(toMajorString(money(amount, currency))).toBe(expected);
  });
});
