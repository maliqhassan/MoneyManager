import { suggestCategory, ruleMatches, type SuggestionRule } from '../../categorization/suggest';
import { DEFAULT_CATEGORIES, findDefaultCategory } from '../../categories/defaults';
import { toCalendarDateInZone } from '../../dates/calendar';
import { isLocalTime, localTimeInZone, zonedDateTimeToInstant } from '../../dates/zoned';
import { normalizeMerchant } from '../../merchants/normalize';
import { buildTransactionSearchText, escapeLike, normalizeSearchText } from '../../text/search';
import {
  allocateBaseAmounts,
  amountRangeBounds,
  canSplit,
  categoryKindFor,
  dayLabel,
  exponentOf,
  groupByLocalDate,
  signedAmount,
  splitRemaining,
} from '../transactions';

describe('search normalisation', () => {
  it('folds case and diacritics locale-independently', () => {
    expect(normalizeSearchText('Café  CRÈME')).toBe('cafe creme');
    expect(normalizeSearchText('Straße')).toBe('strasse');
    expect(normalizeSearchText('İSTANBUL')).toBe('istanbul');
    expect(normalizeSearchText(null)).toBe('');
    expect(buildTransactionSearchText('Grocery Store', 'Weekly SHOP')).toBe(
      'grocery store weekly shop',
    );
  });

  it('escapes LIKE wildcards', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});

describe('merchant normalisation', () => {
  it.each([
    ['WALMART #1234', 'walmart'],
    ['Walmart Store 1234', 'walmart'],
    ['WAL-MART', 'walmart'],
    ['SQ *BLUE BOTTLE COFFEE', 'blue bottle coffee'],
    ['Netflix.com', 'netflix'],
    ["McDonald's 00451", 'mcdonalds'],
    ['Acme Widgets Ltd', 'acme widgets'],
    ['Café de Flore', 'cafe de flore'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeMerchant(input)).toBe(expected);
  });

  it('does not merge different merchants or erase names', () => {
    expect(normalizeMerchant('Shell')).not.toBe(normalizeMerchant('Shell Oil'));
    expect(normalizeMerchant('7-Eleven')).toBe('7 eleven');
    expect(normalizeMerchant('7-ELEVEN #33021')).toBe('7 eleven');
    expect(normalizeMerchant('Store 24')).toBe('store 24');
    expect(normalizeMerchant('   ')).toBeNull();
    expect(normalizeMerchant(null)).toBeNull();
  });
});

describe('deterministic category suggestion', () => {
  const rule = (patch: Partial<SuggestionRule>): SuggestionRule => ({
    id: 'r1',
    matchField: 'payee',
    matchType: 'contains',
    pattern: 'netflix',
    categoryId: 'subscriptions',
    priority: 0,
    isEnabled: true,
    createdAt: '2026-10-01T00:00:00Z',
    ...patch,
  });
  const allowed = new Set(['subscriptions', 'entertainment', 'groceries']);
  const base = {
    payee: 'NETFLIX.COM',
    notes: null,
    merchantKey: 'netflix',
    rules: [] as SuggestionRule[],
    lastCategoryForMerchant: null,
    allowedCategoryIds: allowed,
  };

  it('prefers user rules, highest priority first', () => {
    expect(
      suggestCategory({
        ...base,
        rules: [
          rule({ id: 'low', categoryId: 'entertainment' }),
          rule({ id: 'high', priority: 10 }),
        ],
      }),
    ).toEqual({ categoryId: 'subscriptions', source: 'rule', ruleId: 'high' });
  });

  it('falls back to the last category used for the same merchant', () => {
    expect(suggestCategory({ ...base, lastCategoryForMerchant: 'entertainment' })).toEqual({
      categoryId: 'entertainment',
      source: 'history',
    });
  });

  it('ignores disabled rules and archived/wrong-kind categories', () => {
    expect(
      suggestCategory({
        ...base,
        rules: [rule({ isEnabled: false }), rule({ id: 'x', categoryId: 'archived-cat' })],
        lastCategoryForMerchant: 'archived-cat',
      }),
    ).toBeNull();
  });

  it('matches rule types on normalised text', () => {
    expect(
      ruleMatches({ matchField: 'payee', matchType: 'equals', pattern: 'Netflix' }, 'NETFLIX'),
    ).toBe(true);
    expect(
      ruleMatches({ matchField: 'payee', matchType: 'starts_with', pattern: 'uber' }, 'Uber Eats'),
    ).toBe(true);
    expect(
      ruleMatches({ matchField: 'payee', matchType: 'starts_with', pattern: 'eats' }, 'Uber Eats'),
    ).toBe(false);
    expect(
      ruleMatches(
        { matchField: 'notes', matchType: 'contains', pattern: 'café' },
        'Morning CAFE run',
      ),
    ).toBe(true);
    expect(ruleMatches({ matchField: 'notes', matchType: 'contains', pattern: '' }, 'x')).toBe(
      false,
    );
  });

  it('matches notes rules against notes only', () => {
    expect(
      suggestCategory({
        ...base,
        notes: 'groceries for the week',
        rules: [rule({ matchField: 'notes', pattern: 'groceries', categoryId: 'groceries' })],
      }),
    ).toMatchObject({ categoryId: 'groceries' });
  });
});

describe('local date/time → instant', () => {
  it('converts in ordinary zones and back', () => {
    const at = zonedDateTimeToInstant('2026-10-08', '09:15', 'Asia/Dubai');
    expect(at.toISOString()).toBe('2026-10-08T05:15:00.000Z');
    expect(localTimeInZone(at, 'Asia/Dubai')).toBe('09:15');
    expect(toCalendarDateInZone(at, 'Asia/Dubai')).toBe('2026-10-08');
  });

  it('handles the +14 and −11 extremes without changing the local date', () => {
    const kiritimati = zonedDateTimeToInstant('2026-01-01', '00:30', 'Pacific/Kiritimati');
    expect(kiritimati.toISOString()).toBe('2025-12-31T10:30:00.000Z');
    expect(toCalendarDateInZone(kiritimati, 'Pacific/Kiritimati')).toBe('2026-01-01');
    const pagoPago = zonedDateTimeToInstant('2026-12-31', '23:30', 'Pacific/Pago_Pago');
    expect(pagoPago.toISOString()).toBe('2027-01-01T10:30:00.000Z');
    expect(toCalendarDateInZone(pagoPago, 'Pacific/Pago_Pago')).toBe('2026-12-31');
  });

  it('resolves DST gaps forward and overlaps to the first occurrence', () => {
    // New York springs forward 2026-03-08 02:00 → 03:00.
    expect(zonedDateTimeToInstant('2026-03-08', '02:30', 'America/New_York').toISOString()).toBe(
      '2026-03-08T07:30:00.000Z',
    );
    expect(zonedDateTimeToInstant('2026-03-08', '03:30', 'America/New_York').toISOString()).toBe(
      '2026-03-08T07:30:00.000Z',
    );
    // Falls back 2026-11-01 02:00 → 01:00: 01:30 happens twice (first = EDT).
    expect(zonedDateTimeToInstant('2026-11-01', '01:30', 'America/New_York').toISOString()).toBe(
      '2026-11-01T05:30:00.000Z',
    );
    expect(zonedDateTimeToInstant('2026-11-01', '02:30', 'America/New_York').toISOString()).toBe(
      '2026-11-01T07:30:00.000Z',
    );
  });

  it('validates times', () => {
    expect(isLocalTime('23:59')).toBe(true);
    expect(isLocalTime('24:00')).toBe(false);
    expect(() => zonedDateTimeToInstant('2026-01-01', '9:00', 'UTC')).toThrow(RangeError);
  });
});

describe('transaction rules', () => {
  it('applies signs by type and rejects non-positive magnitudes', () => {
    expect(signedAmount('expense', 8_540)).toBe(-8_540);
    expect(signedAmount('income', 350_000)).toBe(350_000);
    expect(signedAmount('refund', 3_000)).toBe(3_000);
    expect(() => signedAmount('expense', 0)).toThrow(RangeError);
    expect(() => signedAmount('expense', -5)).toThrow(RangeError);
    expect(() => signedAmount('expense', 1.5)).toThrow(RangeError);
  });

  it('maps types to category kinds and split eligibility', () => {
    expect(categoryKindFor('expense')).toBe('expense');
    expect(categoryKindFor('refund')).toBe('expense');
    expect(categoryKindFor('income')).toBe('income');
    expect(categoryKindFor('transfer')).toBeNull();
    expect(canSplit('expense')).toBe(true);
    expect(canSplit('refund')).toBe(false);
    expect(canSplit('transfer')).toBe(false);
  });

  it('allocates split base amounts exactly', () => {
    const base = { amountMinor: -3_667, currency: 'AED' as const };
    const parts = allocateBaseAmounts(base, [-6_000, -2_500, -1_500]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(-3_667);
    expect(parts).toEqual([-2_200, -917, -550]);
    expect(allocateBaseAmounts(base, [0, 0])).toEqual([0, 0]);
  });

  it('computes remaining split amounts', () => {
    expect(splitRemaining(10_000, [6_000, 2_500])).toBe(1_500);
    expect(splitRemaining(10_000, [6_000, 2_500, 1_500])).toBe(0);
    expect(splitRemaining(10_000, [6_000, 5_000])).toBe(-1_000);
  });
});

describe('date grouping relative to the user today', () => {
  it('labels today / yesterday / dates and groups by stored local date', () => {
    expect(dayLabel('2026-10-08', '2026-10-08')).toEqual({ kind: 'today' });
    expect(dayLabel('2026-10-07', '2026-10-08')).toEqual({ kind: 'yesterday' });
    expect(dayLabel('2026-09-30', '2026-10-08')).toEqual({ kind: 'date', date: '2026-09-30' });
    const rows = [
      { id: 'a', localDate: '2026-10-08' },
      { id: 'b', localDate: '2026-10-08' },
      { id: 'c', localDate: '2026-10-06' },
    ];
    expect(groupByLocalDate(rows).map((s) => [s.localDate, s.items.map((i) => i.id)])).toEqual([
      ['2026-10-08', ['a', 'b']],
      ['2026-10-06', ['c']],
    ]);
  });

  it('a late-evening purchase in Kiritimati and Pago Pago stays on its local day', () => {
    // Same UTC instant, different local days → different "today" sections.
    const instant = new Date('2026-06-30T11:00:00Z');
    expect(toCalendarDateInZone(instant, 'Pacific/Kiritimati')).toBe('2026-07-01');
    expect(toCalendarDateInZone(instant, 'Pacific/Pago_Pago')).toBe('2026-06-30');
    expect(dayLabel(toCalendarDateInZone(instant, 'Pacific/Kiritimati'), '2026-07-01')).toEqual({
      kind: 'today',
    });
    expect(dayLabel(toCalendarDateInZone(instant, 'Pacific/Pago_Pago'), '2026-07-01')).toEqual({
      kind: 'yesterday',
    });
  });
});

describe('amount range bounds', () => {
  it('converts major-unit bounds exactly per exponent', () => {
    const b = amountRangeBounds('12.5', '100');
    expect(b.byExponent[2]).toEqual({ min: 1_250, max: 10_000 });
    expect(b.byExponent[0]).toEqual({ min: 13, max: 100 }); // JPY: ceil(12.5)
    expect(b.byExponent[3]).toEqual({ min: 12_500, max: 100_000 });
    expect(amountRangeBounds(null, '0.999').byExponent[2]).toEqual({ min: null, max: 99 });
    expect(amountRangeBounds(null, null).byExponent[2]).toEqual({ min: null, max: null });
    expect(exponentOf('KWD')).toBe(3);
  });
});

describe('default categories', () => {
  const glyphs =
    require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json') as Record<
      string,
      number
    >;

  it('form a valid two-level tree with unique keys and real icons', () => {
    const keys = new Set<string>();
    for (const c of DEFAULT_CATEGORIES) {
      expect(keys.has(c.key)).toBe(false);
      keys.add(c.key);
      expect(glyphs[c.icon]).toBeDefined();
      expect(c.color).toMatch(/^#[0-9A-F]{6}$/);
      if (c.parent) {
        const parent = findDefaultCategory(c.parent);
        expect(parent).not.toBeNull();
        expect(parent?.parent).toBeNull();
        expect(parent?.kind).toBe(c.kind);
      }
    }
    expect(DEFAULT_CATEGORIES.filter((c) => c.kind === 'income').length).toBeGreaterThanOrEqual(9);
    expect(findDefaultCategory('groceries')?.parent).toBe('food');
    expect(findDefaultCategory(null)).toBeNull();
  });
});
