import { type PropsWithChildren, useEffect, useMemo } from 'react';

import type { UserPreferences } from '@/domain/models';
import { usePreferences } from '@/features/settings/hooks/usePreferences';
import { applyLanguage } from '@/i18n';
import { FormatContext } from '@/i18n/FormatContext';
import { createFormatter, type FormatSettings } from '@/i18n/formatter';
import { deviceFormatSettings } from '@/i18n/locale';

export function settingsFromPreferences(prefs: UserPreferences): FormatSettings {
  return {
    locale: prefs.locale,
    language: prefs.language,
    region: prefs.region,
    numberFormat: prefs.numberFormat,
    dateFormat: prefs.dateFormat,
    timeZone: prefs.timeZone,
    firstDayOfWeek: prefs.firstDayOfWeek,
    baseCurrency: prefs.baseCurrency,
  };
}

/**
 * Provides the signed-in user's formatter, derived from their synced
 * preferences (device defaults until those exist), and applies their UI
 * language. Must be inside DataProvider.
 */
export function FormatProvider({ children }: PropsWithChildren) {
  const { data: prefs } = usePreferences();

  const formatter = useMemo(
    () => createFormatter(prefs ? settingsFromPreferences(prefs) : deviceFormatSettings()),
    [prefs],
  );

  useEffect(() => {
    if (prefs?.language) applyLanguage(prefs.language);
  }, [prefs?.language]);

  return <FormatContext.Provider value={formatter}>{children}</FormatContext.Provider>;
}
