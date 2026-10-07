import { validateSplits } from '../splits';
import { buildTransferLegs, impliedRate, InvalidTransferError } from '../transfers';

describe('buildTransferLegs', () => {
  const base = { fromAccountId: 'a', toAccountId: 'b' };

  it('creates balanced legs for same-currency transfers', () => {
    const legs = buildTransferLegs({
      ...base,
      fromCurrency: 'USD',
      toCurrency: 'USD',
      fromAmountMinor: 25_000,
    });
    expect(legs.outgoing).toEqual({ amountMinor: -25_000, currency: 'USD' });
    expect(legs.incoming).toEqual({ amountMinor: 25_000, currency: 'USD' });
    expect(legs.outgoing.amountMinor + legs.incoming.amountMinor).toBe(0);
    expect(legs.fxRate).toBe('1');
  });

  it('uses the actual received amount for cross-currency transfers', () => {
    const legs = buildTransferLegs({
      ...base,
      fromCurrency: 'GBP',
      toCurrency: 'EUR',
      fromAmountMinor: 10_000,
      toAmountMinor: 11_650,
    });
    expect(legs.outgoing).toEqual({ amountMinor: -10_000, currency: 'GBP' });
    expect(legs.incoming).toEqual({ amountMinor: 11_650, currency: 'EUR' });
    expect(legs.fxRate).toBe('1.165');
  });

  it('computes the received amount from a rate', () => {
    const legs = buildTransferLegs({
      ...base,
      fromCurrency: 'USD',
      toCurrency: 'INR',
      fromAmountMinor: 10_000,
      fxRate: '83.12',
    });
    expect(legs.incoming).toEqual({ amountMinor: 831_200, currency: 'INR' });
  });

  it('rejects invalid transfers', () => {
    const valid = { fromCurrency: 'USD', toCurrency: 'USD', fromAmountMinor: 1 } as const;
    expect(() => buildTransferLegs({ ...valid, fromAccountId: 'a', toAccountId: 'a' })).toThrow(
      InvalidTransferError,
    );
    expect(() => buildTransferLegs({ ...base, ...valid, fromAmountMinor: 0 })).toThrow(
      InvalidTransferError,
    );
    expect(() => buildTransferLegs({ ...base, ...valid, toAmountMinor: 2 })).toThrow(
      InvalidTransferError,
    );
    expect(() =>
      buildTransferLegs({ ...base, fromCurrency: 'USD', toCurrency: 'EUR', fromAmountMinor: 1 }),
    ).toThrow(InvalidTransferError);
    expect(() =>
      buildTransferLegs({
        ...base,
        fromCurrency: 'USD',
        toCurrency: 'EUR',
        fromAmountMinor: 1,
        toAmountMinor: -1,
      }),
    ).toThrow(InvalidTransferError);
  });

  it('computes implied rates across exponents', () => {
    expect(
      impliedRate({ amountMinor: 1000, currency: 'USD' }, { amountMinor: 1513, currency: 'JPY' }),
    ).toBe('151.3');
    expect(() =>
      impliedRate({ amountMinor: 0, currency: 'USD' }, { amountMinor: 1, currency: 'JPY' }),
    ).toThrow(InvalidTransferError);
  });
});

describe('validateSplits', () => {
  it('accepts splits that sum exactly to the parent', () => {
    expect(validateSplits(-10_000, [-6_000, -4_000])).toEqual({ ok: true });
  });

  it('reports the difference when sums mismatch', () => {
    expect(validateSplits(-10_000, [-6_000, -3_999])).toEqual({
      ok: false,
      error: 'sum_mismatch',
      differenceMinor: -1,
    });
  });

  it('rejects malformed splits', () => {
    expect(validateSplits(-100, [-100])).toMatchObject({ error: 'too_few_splits' });
    expect(validateSplits(-100, [-100, 0])).toMatchObject({ error: 'zero_split' });
    expect(validateSplits(-100, [-150, 50])).toMatchObject({ error: 'sign_mismatch' });
    expect(validateSplits(-100, [-50.5, -49.5])).toMatchObject({ error: 'invalid_amount' });
  });
});
