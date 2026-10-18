import type { CurrencyCode } from '../currency/currencies';
import { compareDates } from '../dates/calendar';

import type { ResolvedRate } from './policy';

/** How an amount reached the target currency. */
export type ConversionBasis = 'native' | 'snapshot' | 'rate' | 'missing';

/** Per-currency summary of the rates a total used. */
export interface RateUsage {
  currency: CurrencyCode;
  oldestRateDate: string;
  newestRateDate: string;
  sources: string[];
  manual: boolean;
  stale: boolean;
}

/**
 * What a converted total is based on — shown next to it so a converted
 * number is never presented as if it were native, and an incomplete one
 * never as complete.
 */
export interface ConversionNote {
  target: CurrencyCode;
  /** True when anything was converted (snapshot or rate). */
  converted: boolean;
  /** Amounts that used the conversion recorded when they were entered. */
  snapshotCount: number;
  /** Rates applied now (report conversions / current values), per currency. */
  rates: RateUsage[];
  /** Currencies that could not be converted (their amounts are excluded). */
  missing: CurrencyCode[];
  /** Some rate used is stale (current mode). */
  stale: boolean;
}

/** Collects the basis of each amount added to a total. */
export class ConversionNoteBuilder {
  private snapshots = 0;
  private readonly usage = new Map<CurrencyCode, RateUsage>();
  private readonly missingSet = new Set<CurrencyCode>();

  constructor(readonly target: CurrencyCode) {}

  addSnapshot(): void {
    this.snapshots += 1;
  }

  addMissing(currency: CurrencyCode): void {
    this.missingSet.add(currency);
  }

  addRate(currency: CurrencyCode, rate: ResolvedRate): void {
    const u = this.usage.get(currency);
    const sources = rate.source.split('+');
    if (!u) {
      this.usage.set(currency, {
        currency,
        oldestRateDate: rate.rateDate,
        newestRateDate: rate.rateDate,
        sources: [...sources].sort(),
        manual: rate.kind === 'manual',
        stale: rate.stale,
      });
      return;
    }
    if (compareDates(rate.rateDate, u.oldestRateDate) < 0) u.oldestRateDate = rate.rateDate;
    if (compareDates(rate.rateDate, u.newestRateDate) > 0) u.newestRateDate = rate.rateDate;
    u.sources = [...new Set([...u.sources, ...sources])].sort();
    u.manual ||= rate.kind === 'manual';
    u.stale ||= rate.stale;
  }

  /** Merges another note (e.g. per-goal notes into a list summary). */
  merge(note: ConversionNote): void {
    this.snapshots += note.snapshotCount;
    for (const c of note.missing) this.missingSet.add(c);
    for (const r of note.rates) {
      for (const date of [r.oldestRateDate, r.newestRateDate]) {
        this.addRate(r.currency, {
          from: r.currency,
          to: this.target,
          rate: '1',
          rateDate: date,
          source: r.sources.join('+'),
          kind: r.manual ? 'manual' : 'provider',
          derivation: 'direct',
          stale: r.stale,
        });
      }
    }
  }

  build(): ConversionNote {
    const rates = [...this.usage.values()].sort((a, b) => a.currency.localeCompare(b.currency));
    return {
      target: this.target,
      converted: this.snapshots > 0 || rates.length > 0,
      snapshotCount: this.snapshots,
      rates,
      missing: [...this.missingSet].sort(),
      stale: rates.some((r) => r.stale),
    };
  }
}

export const emptyNote = (target: CurrencyCode): ConversionNote =>
  new ConversionNoteBuilder(target).build();
