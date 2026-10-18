import type { CurrencyCode } from '@/domain/currency/currencies';
import { type ConversionNote, ConversionNoteBuilder } from '@/domain/fx/note';
import type { RateMode, ResolvedRate } from '@/domain/fx/policy';
import { convert } from '@/domain/money/conversion';
import { money } from '@/domain/money/money';
import type { SqlExecutor } from '@/database/types';

import { resolveRate } from './rateResolver';

/**
 * Converts amounts with KNOWN rates only (see docs/exchange-rates.md):
 * `historical` mode uses the rate for each entry's date (bounded lookback),
 * `current` mode today's latest cached rate (flagged when stale). Unknown
 * rates return null and are recorded in `missing` — nothing is guessed.
 * Rates are cached per request, and every conversion is recorded in a
 * ConversionNote per target currency so totals can say what they are based on.
 */
export class Converter {
  private readonly rates = new Map<string, ResolvedRate | null>();
  private readonly notes = new Map<CurrencyCode, ConversionNoteBuilder>();
  readonly missing = new Set<CurrencyCode>();

  constructor(
    private readonly db: SqlExecutor,
    readonly mode: RateMode = 'historical',
  ) {}

  private builder(target: CurrencyCode): ConversionNoteBuilder {
    let b = this.notes.get(target);
    if (!b) {
      b = new ConversionNoteBuilder(target);
      this.notes.set(target, b);
    }
    return b;
  }

  async resolve(from: CurrencyCode, to: CurrencyCode, date: string) {
    const key = `${from}>${to}@${date}`;
    if (!this.rates.has(key)) {
      this.rates.set(key, await resolveRate(this.db, from, to, date, this.mode));
    }
    return this.rates.get(key) ?? null;
  }

  /** Back-compat: the rate value only. */
  async rate(from: CurrencyCode, to: CurrencyCode, onOrBefore: string) {
    return (await this.resolve(from, to, onOrBefore))?.rate ?? null;
  }

  async convert(
    amountMinor: number,
    from: CurrencyCode,
    to: CurrencyCode,
    date: string,
  ): Promise<number | null> {
    if (from === to) return amountMinor;
    const rate = await this.resolve(from, to, date);
    if (!rate) {
      this.missing.add(from);
      this.builder(to).addMissing(from);
      return null;
    }
    this.builder(to).addRate(from, rate);
    return convert(money(amountMinor, from), rate.rate, to).amountMinor;
  }

  /** Records that an amount used the conversion stored when it was entered. */
  recordSnapshot(target: CurrencyCode): void {
    this.builder(target).addSnapshot();
  }

  missingList(): CurrencyCode[] {
    return [...this.missing].sort();
  }

  note(target: CurrencyCode): ConversionNote {
    return this.builder(target).build();
  }
}

/**
 * GROUP BY key that keeps amounts needing a rate conversion into `target`
 * apart per entry (`idExpr`), so each is converted and rounded once — the
 * same as its snapshot would be — and report totals reconcile with their
 * drill-down lines. Native and snapshot amounts still group together.
 * Binds `target` twice.
 */
export function perEntryKey(idExpr: string, alias = 't'): string {
  return `CASE WHEN ${alias}.currency = ? OR (${alias}.base_currency = ? AND ${alias}.base_fx_source <> 'unconverted') THEN '' ELSE ${idExpr} END`;
}

/** A grouped transaction amount as stored, with its recorded base snapshot. */
export interface StoredAmount {
  local_date: string;
  currency: CurrencyCode;
  base_currency: CurrencyCode;
  base_fx_source: string;
  amount: number;
  base: number;
}

/**
 * An amount in `target`: the amount itself when already in that currency,
 * else the base snapshot recorded at entry when it is in `target`, else a
 * KNOWN rate on the entry date. Null (recorded in `converter.missing`) when
 * no rate is known. Snapshots are never recomputed.
 */
export function resolveInCurrency(
  converter: Converter,
  row: StoredAmount,
  target: CurrencyCode,
): Promise<number | null> | number {
  if (row.currency === target) return row.amount;
  if (row.base_currency === target && row.base_fx_source !== 'unconverted') {
    converter.recordSnapshot(target);
    return row.base;
  }
  return converter.convert(row.amount, row.currency, target, row.local_date);
}
