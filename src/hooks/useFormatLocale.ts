import { useMemo } from 'react';

import { getDeviceLocale } from '@/i18n/locale';

/**
 * BCP-47 locale used for number/date formatting. Currently the device locale;
 * the next phase layers the user's synced `user_preferences.locale` on top.
 */
export function useFormatLocale(): string {
  return useMemo(() => getDeviceLocale().languageTag, []);
}
