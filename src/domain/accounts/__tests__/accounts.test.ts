import { computeAccountBalance } from '../../finance/balance';
import { summarizeCashFlow } from '../../finance/cashflow';
import { buildTransferLegs } from '../../finance/transfers';
import type { Money } from '../../money/money';
import {
  accountGroup,
  availableCredit,
  buildAccountsOverview,
  canReceiveTransactions,
  isLiability,
  openingBalanceFromEntry,
  openingBalanceToEntry,
  totalsByCurrency,
} from '../accounts';

const usd = (amountMinor: number): Money => ({ amountMinor, currency: 'USD' });

describe('liabilities and opening balances', () => {
  it('classifies credit cards and loans as liabilities', () => {
    expect(isLiability('credit_card')).toBe(true);
    expect(isLiability('loan')).toBe(true);
    expect(isLiability('checking')).toBe(false);
    expect(isLiability('debit_card')).toBe(false);
  });

  it('stores an amount owed on a credit card as a negative balance', () => {
    expect(openingBalanceFromEntry('credit_card', 85_050)).toBe(-85_050);
    expect(openingBalanceFromEntry('loan', 1_000_000)).toBe(-1_000_000);
  });

  it('keeps asset balances as entered, including overdrafts', () => {
    expect(openingBalanceFromEntry('checking', 250_000)).toBe(250_000);
    expect(openingBalanceFromEntry('checking', -1_500)).toBe(-1_500);
  });

  it('supports a credit balance on a card (negative amount owed)', () => {
    expect(openingBalanceFromEntry('credit_card', -2_000)).toBe(2_000);
  });

  it('round-trips between entry and storage and normalises zero', () => {
    for (const type of ['credit_card', 'savings', 'loan', 'cash'] as const) {
      for (const entry of [0, 1, -1, 85_050]) {
        expect(openingBalanceToEntry(type, openingBalanceFromEntry(type, entry))).toBe(entry);
      }
    }
    expect(Object.is(openingBalanceFromEntry('credit_card', 0), 0)).toBe(true);
  });
});

describe('credit cards', () => {
  it('computes available credit from limit and (negative) balance', () => {
    expect(availableCredit(500_000, usd(-85_050))).toEqual(usd(414_950));
    expect(availableCredit(500_000, usd(2_000))).toEqual(usd(502_000));
    expect(availableCredit(null, usd(-1))).toBeNull();
  });

  it('models a card payment as a transfer: no double-counted expense', () => {
    const checking = { currency: 'USD' as const, openingBalanceMinor: 300_000 };
    const card = { currency: 'USD' as const, openingBalanceMinor: 0 };

    // A $120.00 purchase on the card is the expense.
    const purchase = {
      type: 'expense' as const,
      amountMinor: -12_000,
      currency: 'USD' as const,
      deletedAt: null,
    };
    // Paying the card from checking is a transfer.
    const legs = buildTransferLegs({
      fromAccountId: 'checking',
      toAccountId: 'card',
      fromCurrency: 'USD',
      toCurrency: 'USD',
      fromAmountMinor: 12_000,
    });
    const out = { type: 'transfer' as const, ...legs.outgoing, deletedAt: null };
    const into = { type: 'transfer' as const, ...legs.incoming, deletedAt: null };

    expect(computeAccountBalance(card, [purchase, into]).amountMinor).toBe(0);
    expect(computeAccountBalance(checking, [out]).amountMinor).toBe(288_000);

    const flow = summarizeCashFlow([purchase, out, into], 'USD');
    expect(flow.expenses.amountMinor).toBe(12_000); // once, not twice
    expect(flow.income.amountMinor).toBe(0);
  });
});

describe('archived accounts', () => {
  it('cannot receive new transactions until restored', () => {
    expect(canReceiveTransactions({ isArchived: true, deletedAt: null })).toBe(false);
    expect(canReceiveTransactions({ isArchived: false, deletedAt: null })).toBe(true);
    expect(canReceiveTransactions({ isArchived: false, deletedAt: '2026-10-01T00:00:00Z' })).toBe(
      false,
    );
  });
});

describe('grouping and totals', () => {
  it('groups account types', () => {
    expect(accountGroup('checking')).toBe('cash_bank');
    expect(accountGroup('digital_wallet')).toBe('cash_bank');
    expect(accountGroup('credit_card')).toBe('credit');
    expect(accountGroup('loan')).toBe('loans');
    expect(accountGroup('other')).toBe('other');
  });

  it('never sums across currencies', () => {
    expect(
      totalsByCurrency([
        usd(100),
        { amountMinor: 50, currency: 'EUR' },
        usd(-30),
        { amountMinor: 7, currency: 'EUR' },
      ]),
    ).toEqual([
      { amountMinor: 57, currency: 'EUR' },
      { amountMinor: 70, currency: 'USD' },
    ]);
  });
});

describe('buildAccountsOverview', () => {
  const account = (
    id: string,
    type: 'checking' | 'savings' | 'cash' | 'credit_card' | 'loan',
    extra: Partial<{ isArchived: boolean; includeInTotals: boolean }> = {},
  ) => ({ id, type, isArchived: false, includeInTotals: true, ...extra });

  it('groups accounts and totals a single currency', () => {
    const accounts = [
      account('chk', 'checking'),
      account('sav', 'savings'),
      account('cash', 'cash'),
      account('cc', 'credit_card'),
    ];
    const balances = new Map([
      ['chk', usd(825_000)],
      ['sav', usd(350_000)],
      ['cash', usd(25_020)],
      ['cc', usd(-45_000)],
    ]);
    const overview = buildAccountsOverview(accounts, balances, 'USD', () => null);
    expect(overview.groups.map((g) => [g.group, g.items.map((i) => i.account.id)])).toEqual([
      ['cash_bank', ['chk', 'sav', 'cash']],
      ['credit', ['cc']],
    ]);
    expect(overview.combinedTotal).toEqual(usd(1_155_020)); // $12,450.20 - $450.00
    expect(overview.totals).toEqual([usd(1_155_020)]);
    expect(overview.missingRates).toEqual([]);
    expect(overview.activeCount).toBe(4);
  });

  it('refuses to combine currencies without exchange rates', () => {
    const overview = buildAccountsOverview(
      [account('a', 'checking'), account('b', 'savings')],
      new Map<string, Money>([
        ['a', usd(1_025_000)],
        ['b', { amountMinor: 240_000, currency: 'EUR' }],
      ]),
      'USD',
      () => null,
    );
    expect(overview.combinedTotal).toBeNull();
    expect(overview.missingRates).toEqual(['EUR']);
    expect(overview.totals).toEqual([{ amountMinor: 240_000, currency: 'EUR' }, usd(1_025_000)]);
  });

  it('converts with known rates only', () => {
    const overview = buildAccountsOverview(
      [account('a', 'checking'), account('b', 'savings')],
      new Map<string, Money>([
        ['a', usd(10_000)],
        ['b', { amountMinor: 10_000, currency: 'EUR' }],
      ]),
      'USD',
      (c) => (c === 'EUR' ? '1.08' : null),
    );
    expect(overview.combinedTotal).toEqual(usd(20_800));
  });

  it('excludes archived accounts and accounts not counted in totals', () => {
    const overview = buildAccountsOverview(
      [
        account('a', 'checking'),
        account('old', 'savings', { isArchived: true }),
        account('shared', 'credit_card', { includeInTotals: false }),
      ],
      new Map([
        ['a', usd(1_000)],
        ['old', usd(99_999)],
        ['shared', usd(-50_000)],
      ]),
      'USD',
      () => null,
    );
    expect(overview.combinedTotal).toEqual(usd(1_000));
    expect(overview.archived.map((x) => x.account.id)).toEqual(['old']);
    expect(overview.groups.flatMap((g) => g.items).map((i) => i.account.id)).toEqual([
      'a',
      'shared',
    ]);
    expect(overview.activeCount).toBe(2);
  });

  it('handles zero balances and no accounts', () => {
    const empty = buildAccountsOverview([], new Map(), 'GBP', () => null);
    expect(empty.combinedTotal).toEqual({ amountMinor: 0, currency: 'GBP' });
    expect(empty.groups).toEqual([]);
    const zero = buildAccountsOverview(
      [account('z', 'cash')],
      new Map([['z', usd(0)]]),
      'USD',
      () => null,
    );
    expect(zero.combinedTotal).toEqual(usd(0));
  });
});
