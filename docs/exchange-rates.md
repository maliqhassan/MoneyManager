# Exchange rates & multi-currency

How MoneyManager gets exchange rates, stores them, and converts amounts
(Phase 6). All conversion runs through one resolver
(`repositories/sqlite/rateResolver.ts`) over the pure rules in `domain/fx`.

## Compatibility requirements (existing data)

These held before Phase 6 and must keep holding:

- **Amounts** are integer minor units with the ISO exponent from
  `domain/currency` (JPY 0, USD 2, KWD/BHD/OMR/JOD 3). Never floats.
- **Rate direction**: a rate row `{ base, quote, rate }` means
  _1 unit of `base` = `rate` units of `quote`_ (EUR→USD 1.0834).
- **Rates are exact decimal strings** (`^\d+(\.\d{1,18})?$`, positive), the
  same format the server's `app.is_decimal` check accepts.
- **Transaction snapshots are immutable.** Each transaction stores
  `amount_minor` + `currency` (the original) and a base-currency snapshot
  (`base_currency`, `base_amount_minor`, `base_fx_rate`, `base_fx_rate_date`,
  `base_fx_source`) taken at entry. `base_fx_source = 'identity'` when the
  currencies were equal, `'unconverted'` when no rate was known (then
  `base_currency` = the transaction currency). No later rate ever rewrites a
  stored snapshot; a new rate only affects _report_ conversions.
- **Transfers** store the actual sent and received amounts on their two legs;
  a rate is never used to derive the received amount.
- **Rounding**: one rounding step, half away from zero, at the target
  currency's minor unit (`domain/money/decimal.divideAndRound`).
- Server `exchange_rates` (reference table, read-only for users, no writer
  yet) is unchanged. The local `exchange_rates` table is a device cache and is
  not synced, so adding local columns needs no Supabase migration.

## Provider

[Frankfurter](https://frankfurter.dev) v2 — `GET https://api.frankfurter.dev/v2/rates`
with `base`, `quotes`, and either `date=YYYY-MM-DD` or `from`/`to`.

- No API key, no account, no stated quotas (abuse rate limiting only).
  Nothing secret is shipped or configured.
- Blended daily rates from ~100 central banks and official sources; covers
  all 94 currencies MoneyManager supports (checked against the live API).
  History back to 1999 for major currencies.
- Software MIT-licensed; blended rates are Frankfurter's own calculation and
  free to use commercially. They are **reference rates, not official or
  bank rates**, provided as is, and may be late, missing or revised — the UI
  says so.
- Response: a JSON array of `{ date, base, quote, rate }`. Each quote carries
  its own `date` (a currency whose sources didn't publish today has an older
  date). Rates are JSON numbers with ~5 significant digits, and small values
  lose digits (PKR→KWD `0.00112`). So MoneyManager always requests
  **`base=USD`**: every supported currency is ≥ 0.3 per USD, which keeps full
  precision; other pairs are derived exactly (see below).
- Numbers are read from the raw response text (`domain/fx/json.ts`), never
  through `JSON.parse` floats, then validated before anything is stored.
- Only currency codes are sent to the provider — never amounts, accounts or
  descriptions. The request reveals the device's IP to Frankfurter
  (Cloudflare), like any web request.

Providers implement `RateProvider` (`services/fx/provider.ts`); domain code
never depends on one API.

## Storage (local SQLite, migration 5)

`exchange_rates`: `base_currency`, `quote_currency`, `rate`, `rate_date`,
`source`, `kind` (`provider` | `manual`), `fetched_at` (retrieval time; entry
time for manual rates), `attribution`, `created_at`.
`UNIQUE (base_currency, quote_currency, rate_date, source)` prevents
duplicates and serves lookups.

- Provider rows (`source = 'frankfurter'`, base USD) are upserted: a refetch of
  the same date updates the value (providers revise) and `fetched_at`.
- Manual rows (`source = 'manual'`) are the user's own; replacing one needs
  explicit confirmation. A manual rate never overwrites a provider row (they
  have different sources).
- `fx_fetch_log`: last attempt/success/error per refresh scope, and a
  `retry_after` set by HTTP 429, so navigation never triggers repeated calls.

Rates are device-local: provider rates are refetched on each device; manual
rates are **not synced yet** (see Limitations).

## Resolving a rate

`resolve(from, to, date, mode)` returns the rate with its effective date,
source, kind and derivation, or null — never a guess. Candidates:

1. direct (`from→to`), 2. inverse (`to→from`), 3. cross via USD
   (`USD→to ÷ USD→from`; the older leg's date is the effective date).

Choice: latest effective date; on the same date a manual rate wins over a
provider rate (the user entered it deliberately), then direct > inverse >
cross. Derived rates (inverse/cross) are computed exactly with BigInt and
rounded once to 12 significant digits (max 18 decimals), so the stored
`base_fx_rate` reproduces the stored `base_amount_minor`.

Modes (`domain/fx/policy.ts`, `FX_POLICY`):

| Mode         | Used for                                                   | Rule                                                                                                                   |
| ------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `historical` | entry snapshots, reports, budgets, goal contributions      | rate dated on or before the entry date, at most **7 days** older (provider) or **31 days** (manual); otherwise missing |
| `current`    | Home/account combined balance, subscription cost estimates | latest cached rate of any age; **stale** when older than 3 days (provider) or 31 days (manual) — shown with its date   |

A historical report never applies today's rate to an old transaction.

## Exact arithmetic and rounding

- Amounts: integer minor units (`domain/money`); rates: decimal strings
  (`^d+(.d{1,18})?# Exchange rates & multi-currency

How MoneyManager gets exchange rates, stores them, and converts amounts
(Phase 6). All conversion runs through one resolver
(`repositories/sqlite/rateResolver.ts`) over the pure rules in `domain/fx`.

## Compatibility requirements (existing data)

These held before Phase 6 and must keep holding:

- **Amounts** are integer minor units with the ISO exponent from
  `domain/currency` (JPY 0, USD 2, KWD/BHD/OMR/JOD 3). Never floats.
- **Rate direction**: a rate row `{ base, quote, rate }` means
  _1 unit of `base` = `rate` units of `quote`_ (EUR→USD 1.0834).
- **Rates are exact decimal strings** (`^\d+(\.\d{1,18})?$`, positive), the
  same format the server's `app.is_decimal` check accepts.
- **Transaction snapshots are immutable.** Each transaction stores
  `amount_minor` + `currency` (the original) and a base-currency snapshot
  (`base_currency`, `base_amount_minor`, `base_fx_rate`, `base_fx_rate_date`,
  `base_fx_source`) taken at entry. `base_fx_source = 'identity'` when the
  currencies were equal, `'unconverted'` when no rate was known (then
  `base_currency` = the transaction currency). No later rate ever rewrites a
  stored snapshot; a new rate only affects _report_ conversions.
- **Transfers** store the actual sent and received amounts on their two legs;
  a rate is never used to derive the received amount.
- **Rounding**: one rounding step, half away from zero, at the target
  currency's minor unit (`domain/money/decimal.divideAndRound`).
- Server `exchange_rates` (reference table, read-only for users, no writer
  yet) is unchanged. The local `exchange_rates` table is a device cache and is
  not synced, so adding local columns needs no Supabase migration.

## Provider

[Frankfurter](https://frankfurter.dev) v2 — `GET https://api.frankfurter.dev/v2/rates`
with `base`, `quotes`, and either `date=YYYY-MM-DD` or `from`/`to`.

- No API key, no account, no stated quotas (abuse rate limiting only).
  Nothing secret is shipped or configured.
- Blended daily rates from ~100 central banks and official sources; covers
  all 94 currencies MoneyManager supports (checked against the live API).
  History back to 1999 for major currencies.
- Software MIT-licensed; blended rates are Frankfurter's own calculation and
  free to use commercially. They are **reference rates, not official or
  bank rates**, provided as is, and may be late, missing or revised — the UI
  says so.
- Response: a JSON array of `{ date, base, quote, rate }`. Each quote carries
  its own `date` (a currency whose sources didn't publish today has an older
  date). Rates are JSON numbers with ~5 significant digits, and small values
  lose digits (PKR→KWD `0.00112`). So MoneyManager always requests
  **`base=USD`**: every supported currency is ≥ 0.3 per USD, which keeps full
  precision; other pairs are derived exactly (see below).
- Numbers are read from the raw response text (`domain/fx/json.ts`), never
  through `JSON.parse` floats, then validated before anything is stored.
- Only currency codes are sent to the provider — never amounts, accounts or
  descriptions. The request reveals the device's IP to Frankfurter
  (Cloudflare), like any web request.

Providers implement `RateProvider` (`services/fx/provider.ts`); domain code
never depends on one API.

## Storage (local SQLite, migration 5)

`exchange_rates`: `base_currency`, `quote_currency`, `rate`, `rate_date`,
`source`, `kind` (`provider` | `manual`), `fetched_at` (retrieval time; entry
time for manual rates), `attribution`, `created_at`.
`UNIQUE (base_currency, quote_currency, rate_date, source)` prevents
duplicates and serves lookups.

- Provider rows (`source = 'frankfurter'`, base USD) are upserted: a refetch of
  the same date updates the value (providers revise) and `fetched_at`.
- Manual rows (`source = 'manual'`) are the user's own; replacing one needs
  explicit confirmation. A manual rate never overwrites a provider row (they
  have different sources).
- `fx_fetch_log`: last attempt/success/error per refresh scope, and a
  `retry_after` set by HTTP 429, so navigation never triggers repeated calls.

Rates are device-local: provider rates are refetched on each device; manual
rates are **not synced yet** (see Limitations).

## Resolving a rate

`resolve(from, to, date, mode)` returns the rate with its effective date,
source, kind and derivation, or null — never a guess. Candidates:

1. direct (`from→to`), 2. inverse (`to→from`), 3. cross via USD
   (`USD→to ÷ USD→from`; the older leg's date is the effective date).

Choice: latest effective date; on the same date a manual rate wins over a
provider rate (the user entered it deliberately), then direct > inverse >
cross. Derived rates (inverse/cross) are computed exactly with BigInt and
rounded once to 12 significant digits (max 18 decimals), so the stored
`base_fx_rate` reproduces the stored `base_amount_minor`.

Modes (`domain/fx/policy.ts`, `FX_POLICY`):

| Mode         | Used for                                                   | Rule                                                                                                                   |
| ------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `historical` | entry snapshots, reports, budgets, goal contributions      | rate dated on or before the entry date, at most **7 days** older (provider) or **31 days** (manual); otherwise missing |
| `current`    | Home/account combined balance, subscription cost estimates | latest cached rate of any age; **stale** when older than 3 days (provider) or 31 days (manual) — shown with its date   |

), validated positive and within [1e-9, 1e9]
(`domain/fx/rateMath.validateRate`); provider numbers are read from the raw
JSON text (`domain/fx/json.ts`) and exponents are expanded exactly.

- Conversion: `target_minor = amount_minor × rate × 10^targetExp / 10^sourceExp`
  in BigInt, rounded **once, half away from zero**; results outside
  ±10^15 minor units are rejected (overflow guard).
- Derived rates (inverse, cross via USD) are computed as exact fractions and
  rounded once to 12 significant digits; that decimal is what a snapshot
  stores, so `base_fx_rate` reproduces `base_amount_minor`.
- **Per entry**: every amount that needs a rate is converted on its own;
  totals are sums of converted entries (snapshots already are). Reports group
  such entries per transaction (`perEntryKey`), so a report figure equals the
  sum of its drill-down lines.
- Imported or typed amounts are never rounded to fit a conversion.

## Conversion policy per feature

| Feature                                                         | Amount used in the base/target currency                                                                                                             |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account balances                                                | always in the account's own currency                                                                                                                |
| Combined balance (Home, Accounts)                               | each balance × current rate; stale/missing labelled                                                                                                 |
| Home "this month" and top categories                            | same as Reports (snapshot or the rate on each entry's date); incomplete → no total                                                                  |
| Reports (cash flow, trend, categories, merchants, savings rate) | 1) native if same currency; 2) the entry's recorded snapshot if it is in the target; 3) historical rate on the entry date; else excluded and listed |
| Report drill-down                                               | each line also shows its value in the base currency (same policy); the base total equals the report figure                                          |
| Budget vs actual                                                | same order, in the budget's currency                                                                                                                |
| Goals                                                           | each contribution at the rate on its contribution date ("value when contributed")                                                                   |
| Subscriptions (monthly/yearly cost)                             | current rate, marked approximate                                                                                                                    |
| Transfers                                                       | actual sent and received amounts; never derived                                                                                                     |
| Balance history                                                 | per account, own currency (no conversion)                                                                                                           |
| CSV import                                                      | rows must be in the account's currency; snapshot at entry as above                                                                                  |
| CSV export (format v2)                                          | original amount + snapshot (`base_amount`, `base_fx_rate`, `base_fx_rate_date`, `base_conversion`); manual rates exported in `exchange_rates.csv`   |

Every converted total says it is converted, into which currency, and the rate
date range and source; incomplete totals list the excluded currencies.

## Refresh

Foreground only (no background service): on app start, when the app returns
to the foreground, and when connectivity returns, at most every 12 hours
(`FX_POLICY.refreshEveryHours`), never more than once per 15 minutes on
failure, and not before a server-provided `Retry-After`. "Refresh now" on the
Exchange rates screen bypasses the 12-hour wait.

A refresh asks only for currencies in use (accounts, transactions, goals,
budgets, bills, base currency):

- forward fill: from the day after the newest cached rate (at most 31 days
  back; the last 2 days are always re-checked because sources publish late)
  to today;
- backfill: dates of foreign-currency entries older than the cache, in
  366-day requests, at most 3 years per refresh (continues next time).
  Ranges already requested are remembered (`fx_fetch_log` per currency), so
  dates the provider has no data for are not requested again.
- Unchanged values are not rewritten, so a refresh only refreshes screens when
  a rate actually changed.

Timeouts (15 s), HTTP errors, rate limiting and malformed or invalid
responses leave the cache untouched. Transaction entry never waits for rates.

## Manual rates

More → Exchange rates → Add a rate: explicit "from" and "to" currencies,
effective date (not in the future), the rate as "1 FROM = ? TO", a live
example conversion, and a confirmation step. Labelled "Your rate" everywhere
— never presented as a market rate.

## Editing entries

Editing anything but the amount, currency or date keeps the stored snapshot.
Changing one of those is a new conversion, with the rate for the (new) date.

## Limitations

- Manual rates live on one device (not synced). A synced
  `user_exchange_rates` table needs a Supabase migration — proposed, not
  applied.
- Rates are reference mid-market rates, not what a bank or card charged. For
  the real amount, record a cross-currency transfer with the received amount.
- History older than 3 years is backfilled over several refreshes.
- A split entry recorded without any conversion ("unconverted") is converted
  per split line in category reports and as a whole in income/spending, so
  the two can differ by one minor unit. Entries with a recorded snapshot
  always agree (their split base amounts are allocated to add up).
