import type { CurrencyCode } from '../currency/currencies';

/**
 * Countries/regions offered during onboarding and in regional preferences.
 * A region only provides *suggestions* (currency, formatting locale); the
 * user confirms or overrides each one. Region is never inferred from IP.
 *
 * `locale` is the BCP-47 tag whose conventions (separators, date order) are
 * typical for the region in English UI; Intl falls back gracefully when a
 * combination is unknown.
 */
export interface Country {
  code: string; // ISO 3166-1 alpha-2
  name: string;
  currency: CurrencyCode;
  locale: string;
}

export const COUNTRIES: readonly Country[] = [
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', locale: 'en-AE' },
  { code: 'AR', name: 'Argentina', currency: 'ARS', locale: 'es-AR' },
  { code: 'AT', name: 'Austria', currency: 'EUR', locale: 'de-AT' },
  { code: 'AU', name: 'Australia', currency: 'AUD', locale: 'en-AU' },
  { code: 'BD', name: 'Bangladesh', currency: 'BDT', locale: 'en-BD' },
  { code: 'BE', name: 'Belgium', currency: 'EUR', locale: 'nl-BE' },
  { code: 'BH', name: 'Bahrain', currency: 'BHD', locale: 'en-BH' },
  { code: 'BR', name: 'Brazil', currency: 'BRL', locale: 'pt-BR' },
  { code: 'CA', name: 'Canada', currency: 'CAD', locale: 'en-CA' },
  { code: 'CH', name: 'Switzerland', currency: 'CHF', locale: 'de-CH' },
  { code: 'CL', name: 'Chile', currency: 'CLP', locale: 'es-CL' },
  { code: 'CN', name: 'China', currency: 'CNY', locale: 'zh-CN' },
  { code: 'CO', name: 'Colombia', currency: 'COP', locale: 'es-CO' },
  { code: 'CZ', name: 'Czechia', currency: 'CZK', locale: 'cs-CZ' },
  { code: 'DE', name: 'Germany', currency: 'EUR', locale: 'de-DE' },
  { code: 'DK', name: 'Denmark', currency: 'DKK', locale: 'da-DK' },
  { code: 'EG', name: 'Egypt', currency: 'EGP', locale: 'en-EG' },
  { code: 'ES', name: 'Spain', currency: 'EUR', locale: 'es-ES' },
  { code: 'FI', name: 'Finland', currency: 'EUR', locale: 'fi-FI' },
  { code: 'FR', name: 'France', currency: 'EUR', locale: 'fr-FR' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', locale: 'en-GB' },
  { code: 'GH', name: 'Ghana', currency: 'GHS', locale: 'en-GH' },
  { code: 'GR', name: 'Greece', currency: 'EUR', locale: 'el-GR' },
  { code: 'HK', name: 'Hong Kong', currency: 'HKD', locale: 'en-HK' },
  { code: 'HU', name: 'Hungary', currency: 'HUF', locale: 'hu-HU' },
  { code: 'ID', name: 'Indonesia', currency: 'IDR', locale: 'id-ID' },
  { code: 'IE', name: 'Ireland', currency: 'EUR', locale: 'en-IE' },
  { code: 'IL', name: 'Israel', currency: 'ILS', locale: 'en-IL' },
  { code: 'IN', name: 'India', currency: 'INR', locale: 'en-IN' },
  { code: 'IT', name: 'Italy', currency: 'EUR', locale: 'it-IT' },
  { code: 'JO', name: 'Jordan', currency: 'JOD', locale: 'en-JO' },
  { code: 'JP', name: 'Japan', currency: 'JPY', locale: 'ja-JP' },
  { code: 'KE', name: 'Kenya', currency: 'KES', locale: 'en-KE' },
  { code: 'KR', name: 'South Korea', currency: 'KRW', locale: 'ko-KR' },
  { code: 'KW', name: 'Kuwait', currency: 'KWD', locale: 'en-KW' },
  { code: 'LK', name: 'Sri Lanka', currency: 'LKR', locale: 'en-LK' },
  { code: 'MA', name: 'Morocco', currency: 'MAD', locale: 'fr-MA' },
  { code: 'MX', name: 'Mexico', currency: 'MXN', locale: 'es-MX' },
  { code: 'MY', name: 'Malaysia', currency: 'MYR', locale: 'en-MY' },
  { code: 'NG', name: 'Nigeria', currency: 'NGN', locale: 'en-NG' },
  { code: 'NL', name: 'Netherlands', currency: 'EUR', locale: 'nl-NL' },
  { code: 'NO', name: 'Norway', currency: 'NOK', locale: 'nb-NO' },
  { code: 'NP', name: 'Nepal', currency: 'NPR', locale: 'en-NP' },
  { code: 'NZ', name: 'New Zealand', currency: 'NZD', locale: 'en-NZ' },
  { code: 'OM', name: 'Oman', currency: 'OMR', locale: 'en-OM' },
  { code: 'PE', name: 'Peru', currency: 'PEN', locale: 'es-PE' },
  { code: 'PH', name: 'Philippines', currency: 'PHP', locale: 'en-PH' },
  { code: 'PK', name: 'Pakistan', currency: 'PKR', locale: 'en-PK' },
  { code: 'PL', name: 'Poland', currency: 'PLN', locale: 'pl-PL' },
  { code: 'PT', name: 'Portugal', currency: 'EUR', locale: 'pt-PT' },
  { code: 'QA', name: 'Qatar', currency: 'QAR', locale: 'en-QA' },
  { code: 'RO', name: 'Romania', currency: 'RON', locale: 'ro-RO' },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR', locale: 'en-SA' },
  { code: 'SE', name: 'Sweden', currency: 'SEK', locale: 'sv-SE' },
  { code: 'SG', name: 'Singapore', currency: 'SGD', locale: 'en-SG' },
  { code: 'TH', name: 'Thailand', currency: 'THB', locale: 'th-TH' },
  { code: 'TR', name: 'Türkiye', currency: 'TRY', locale: 'tr-TR' },
  { code: 'TW', name: 'Taiwan', currency: 'TWD', locale: 'zh-TW' },
  { code: 'UA', name: 'Ukraine', currency: 'UAH', locale: 'uk-UA' },
  { code: 'US', name: 'United States', currency: 'USD', locale: 'en-US' },
  { code: 'VN', name: 'Vietnam', currency: 'VND', locale: 'vi-VN' },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR', locale: 'en-ZA' },
];

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

export function findCountry(code: string | null | undefined): Country | null {
  return code ? (BY_CODE.get(code.toUpperCase()) ?? null) : null;
}

export function searchCountries(query: string): Country[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...COUNTRIES];
  return COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q);
}
