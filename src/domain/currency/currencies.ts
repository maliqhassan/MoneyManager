/**
 * ISO 4217 currency metadata.
 *
 * `minorUnits` is the ISO exponent: the number of decimal places of the
 * currency's minor unit (USD 2 → cents, JPY 0, KWD 3). All amounts in the app
 * are stored as integers in minor units, so this table is the single source
 * of truth for converting between user-facing and stored values.
 *
 * Adding a currency = adding one line here; no business logic changes.
 * Never change an existing exponent without a data migration.
 * Symbols are NOT stored here: they are locale-dependent and come from Intl
 * (see i18n/format.ts → getCurrencySymbol).
 */
export const CURRENCIES = {
  AED: { minorUnits: 2, name: 'UAE Dirham' },
  ALL: { minorUnits: 2, name: 'Albanian Lek' },
  AMD: { minorUnits: 2, name: 'Armenian Dram' },
  ARS: { minorUnits: 2, name: 'Argentine Peso' },
  AUD: { minorUnits: 2, name: 'Australian Dollar' },
  AZN: { minorUnits: 2, name: 'Azerbaijani Manat' },
  BAM: { minorUnits: 2, name: 'Bosnia-Herzegovina Convertible Mark' },
  BDT: { minorUnits: 2, name: 'Bangladeshi Taka' },
  BHD: { minorUnits: 3, name: 'Bahraini Dinar' },
  BND: { minorUnits: 2, name: 'Brunei Dollar' },
  BOB: { minorUnits: 2, name: 'Bolivian Boliviano' },
  BRL: { minorUnits: 2, name: 'Brazilian Real' },
  BWP: { minorUnits: 2, name: 'Botswana Pula' },
  BYN: { minorUnits: 2, name: 'Belarusian Ruble' },
  CAD: { minorUnits: 2, name: 'Canadian Dollar' },
  CHF: { minorUnits: 2, name: 'Swiss Franc' },
  CLP: { minorUnits: 0, name: 'Chilean Peso' },
  CNY: { minorUnits: 2, name: 'Chinese Yuan' },
  COP: { minorUnits: 2, name: 'Colombian Peso' },
  CRC: { minorUnits: 2, name: 'Costa Rican Colón' },
  CZK: { minorUnits: 2, name: 'Czech Koruna' },
  DKK: { minorUnits: 2, name: 'Danish Krone' },
  DOP: { minorUnits: 2, name: 'Dominican Peso' },
  DZD: { minorUnits: 2, name: 'Algerian Dinar' },
  EGP: { minorUnits: 2, name: 'Egyptian Pound' },
  ETB: { minorUnits: 2, name: 'Ethiopian Birr' },
  EUR: { minorUnits: 2, name: 'Euro' },
  FJD: { minorUnits: 2, name: 'Fijian Dollar' },
  GBP: { minorUnits: 2, name: 'British Pound' },
  GEL: { minorUnits: 2, name: 'Georgian Lari' },
  GHS: { minorUnits: 2, name: 'Ghanaian Cedi' },
  GTQ: { minorUnits: 2, name: 'Guatemalan Quetzal' },
  HKD: { minorUnits: 2, name: 'Hong Kong Dollar' },
  HUF: { minorUnits: 2, name: 'Hungarian Forint' },
  IDR: { minorUnits: 2, name: 'Indonesian Rupiah' },
  ILS: { minorUnits: 2, name: 'Israeli New Shekel' },
  INR: { minorUnits: 2, name: 'Indian Rupee' },
  IQD: { minorUnits: 3, name: 'Iraqi Dinar' },
  ISK: { minorUnits: 0, name: 'Icelandic Króna' },
  JMD: { minorUnits: 2, name: 'Jamaican Dollar' },
  JOD: { minorUnits: 3, name: 'Jordanian Dinar' },
  JPY: { minorUnits: 0, name: 'Japanese Yen' },
  KES: { minorUnits: 2, name: 'Kenyan Shilling' },
  KHR: { minorUnits: 2, name: 'Cambodian Riel' },
  KRW: { minorUnits: 0, name: 'South Korean Won' },
  KWD: { minorUnits: 3, name: 'Kuwaiti Dinar' },
  KZT: { minorUnits: 2, name: 'Kazakhstani Tenge' },
  LBP: { minorUnits: 2, name: 'Lebanese Pound' },
  LKR: { minorUnits: 2, name: 'Sri Lankan Rupee' },
  LYD: { minorUnits: 3, name: 'Libyan Dinar' },
  MAD: { minorUnits: 2, name: 'Moroccan Dirham' },
  MDL: { minorUnits: 2, name: 'Moldovan Leu' },
  MKD: { minorUnits: 2, name: 'Macedonian Denar' },
  MNT: { minorUnits: 2, name: 'Mongolian Tögrög' },
  MOP: { minorUnits: 2, name: 'Macanese Pataca' },
  MUR: { minorUnits: 2, name: 'Mauritian Rupee' },
  MXN: { minorUnits: 2, name: 'Mexican Peso' },
  MYR: { minorUnits: 2, name: 'Malaysian Ringgit' },
  NAD: { minorUnits: 2, name: 'Namibian Dollar' },
  NGN: { minorUnits: 2, name: 'Nigerian Naira' },
  NOK: { minorUnits: 2, name: 'Norwegian Krone' },
  NPR: { minorUnits: 2, name: 'Nepalese Rupee' },
  NZD: { minorUnits: 2, name: 'New Zealand Dollar' },
  OMR: { minorUnits: 3, name: 'Omani Rial' },
  PEN: { minorUnits: 2, name: 'Peruvian Sol' },
  PHP: { minorUnits: 2, name: 'Philippine Peso' },
  PKR: { minorUnits: 2, name: 'Pakistani Rupee' },
  PLN: { minorUnits: 2, name: 'Polish Złoty' },
  PYG: { minorUnits: 0, name: 'Paraguayan Guaraní' },
  QAR: { minorUnits: 2, name: 'Qatari Riyal' },
  RON: { minorUnits: 2, name: 'Romanian Leu' },
  RSD: { minorUnits: 2, name: 'Serbian Dinar' },
  RUB: { minorUnits: 2, name: 'Russian Ruble' },
  RWF: { minorUnits: 0, name: 'Rwandan Franc' },
  SAR: { minorUnits: 2, name: 'Saudi Riyal' },
  SEK: { minorUnits: 2, name: 'Swedish Krona' },
  SGD: { minorUnits: 2, name: 'Singapore Dollar' },
  THB: { minorUnits: 2, name: 'Thai Baht' },
  TND: { minorUnits: 3, name: 'Tunisian Dinar' },
  TRY: { minorUnits: 2, name: 'Turkish Lira' },
  TTD: { minorUnits: 2, name: 'Trinidad and Tobago Dollar' },
  TWD: { minorUnits: 2, name: 'New Taiwan Dollar' },
  TZS: { minorUnits: 2, name: 'Tanzanian Shilling' },
  UAH: { minorUnits: 2, name: 'Ukrainian Hryvnia' },
  UGX: { minorUnits: 0, name: 'Ugandan Shilling' },
  USD: { minorUnits: 2, name: 'US Dollar' },
  UYU: { minorUnits: 2, name: 'Uruguayan Peso' },
  UZS: { minorUnits: 2, name: 'Uzbekistani Som' },
  VND: { minorUnits: 0, name: 'Vietnamese Đồng' },
  XAF: { minorUnits: 0, name: 'Central African CFA Franc' },
  XOF: { minorUnits: 0, name: 'West African CFA Franc' },
  ZAR: { minorUnits: 2, name: 'South African Rand' },
  ZMW: { minorUnits: 2, name: 'Zambian Kwacha' },
} as const satisfies Record<string, { minorUnits: 0 | 2 | 3; name: string }>;

export type CurrencyCode = keyof typeof CURRENCIES;

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export const DEFAULT_CURRENCY: CurrencyCode = 'USD';

/** Shown first in pickers; the rest follow alphabetically. */
export const POPULAR_CURRENCIES: readonly CurrencyCode[] = [
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'AED',
  'INR',
  'PKR',
  'SAR',
  'JPY',
  'CNY',
  'CHF',
];

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, value);
}

export function getMinorUnits(currency: CurrencyCode): number {
  return CURRENCIES[currency].minorUnits;
}

export function getCurrencyName(currency: CurrencyCode): string {
  return CURRENCIES[currency].name;
}

/** Case-insensitive match on code or English name; popular currencies first. */
export function searchCurrencies(query: string): CurrencyCode[] {
  const q = query.trim().toLowerCase();
  const popular = new Set(POPULAR_CURRENCIES);
  const ordered = [...POPULAR_CURRENCIES, ...CURRENCY_CODES.filter((c) => !popular.has(c)).sort()];
  if (!q) return ordered;
  return ordered.filter(
    (code) => code.toLowerCase().includes(q) || CURRENCIES[code].name.toLowerCase().includes(q),
  );
}
