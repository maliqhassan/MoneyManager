/**
 * ISO 4217 currency metadata.
 *
 * `minorUnits` is the ISO exponent: the number of decimal places of the
 * currency's minor unit (USD 2 → cents, JPY 0, KWD 3). All amounts in the app
 * are stored as integers in minor units, so this table is the single source
 * of truth for converting between user-facing and stored values.
 *
 * Extend this list as markets are added; never change an existing exponent
 * without a data migration.
 */
export const CURRENCIES = {
  AED: { minorUnits: 2, name: 'UAE Dirham' },
  ARS: { minorUnits: 2, name: 'Argentine Peso' },
  AUD: { minorUnits: 2, name: 'Australian Dollar' },
  BDT: { minorUnits: 2, name: 'Bangladeshi Taka' },
  BHD: { minorUnits: 3, name: 'Bahraini Dinar' },
  BRL: { minorUnits: 2, name: 'Brazilian Real' },
  CAD: { minorUnits: 2, name: 'Canadian Dollar' },
  CHF: { minorUnits: 2, name: 'Swiss Franc' },
  CLP: { minorUnits: 0, name: 'Chilean Peso' },
  CNY: { minorUnits: 2, name: 'Chinese Yuan' },
  COP: { minorUnits: 2, name: 'Colombian Peso' },
  CZK: { minorUnits: 2, name: 'Czech Koruna' },
  DKK: { minorUnits: 2, name: 'Danish Krone' },
  EGP: { minorUnits: 2, name: 'Egyptian Pound' },
  EUR: { minorUnits: 2, name: 'Euro' },
  GBP: { minorUnits: 2, name: 'British Pound' },
  HKD: { minorUnits: 2, name: 'Hong Kong Dollar' },
  HUF: { minorUnits: 2, name: 'Hungarian Forint' },
  IDR: { minorUnits: 2, name: 'Indonesian Rupiah' },
  ILS: { minorUnits: 2, name: 'Israeli New Shekel' },
  INR: { minorUnits: 2, name: 'Indian Rupee' },
  ISK: { minorUnits: 0, name: 'Icelandic Króna' },
  JOD: { minorUnits: 3, name: 'Jordanian Dinar' },
  JPY: { minorUnits: 0, name: 'Japanese Yen' },
  KES: { minorUnits: 2, name: 'Kenyan Shilling' },
  KRW: { minorUnits: 0, name: 'South Korean Won' },
  KWD: { minorUnits: 3, name: 'Kuwaiti Dinar' },
  LKR: { minorUnits: 2, name: 'Sri Lankan Rupee' },
  MXN: { minorUnits: 2, name: 'Mexican Peso' },
  MYR: { minorUnits: 2, name: 'Malaysian Ringgit' },
  NGN: { minorUnits: 2, name: 'Nigerian Naira' },
  NOK: { minorUnits: 2, name: 'Norwegian Krone' },
  NPR: { minorUnits: 2, name: 'Nepalese Rupee' },
  NZD: { minorUnits: 2, name: 'New Zealand Dollar' },
  OMR: { minorUnits: 3, name: 'Omani Rial' },
  PHP: { minorUnits: 2, name: 'Philippine Peso' },
  PKR: { minorUnits: 2, name: 'Pakistani Rupee' },
  PLN: { minorUnits: 2, name: 'Polish Złoty' },
  QAR: { minorUnits: 2, name: 'Qatari Riyal' },
  RON: { minorUnits: 2, name: 'Romanian Leu' },
  SAR: { minorUnits: 2, name: 'Saudi Riyal' },
  SEK: { minorUnits: 2, name: 'Swedish Krona' },
  SGD: { minorUnits: 2, name: 'Singapore Dollar' },
  THB: { minorUnits: 2, name: 'Thai Baht' },
  TRY: { minorUnits: 2, name: 'Turkish Lira' },
  TWD: { minorUnits: 2, name: 'New Taiwan Dollar' },
  UAH: { minorUnits: 2, name: 'Ukrainian Hryvnia' },
  USD: { minorUnits: 2, name: 'US Dollar' },
  VND: { minorUnits: 0, name: 'Vietnamese Đồng' },
  ZAR: { minorUnits: 2, name: 'South African Rand' },
} as const satisfies Record<string, { minorUnits: 0 | 2 | 3; name: string }>;

export type CurrencyCode = keyof typeof CURRENCIES;

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export const DEFAULT_CURRENCY: CurrencyCode = 'USD';

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, value);
}

export function getMinorUnits(currency: CurrencyCode): number {
  return CURRENCIES[currency].minorUnits;
}
