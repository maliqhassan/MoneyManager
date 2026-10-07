import { createContext, useContext } from 'react';

import { createFormatter, type Formatter } from './formatter';
import { deviceFormatSettings } from './locale';

let deviceFormatter: Formatter | null = null;

/** Formatter from device settings (cached). Used before user preferences exist. */
export function getDeviceFormatter(): Formatter {
  deviceFormatter ??= createFormatter(deviceFormatSettings());
  return deviceFormatter;
}

export const FormatContext = createContext<Formatter | null>(null);

/**
 * The current user's formatter (number/date/currency/time-zone aware).
 * Falls back to device settings outside the signed-in shell.
 */
export function useFormatter(): Formatter {
  return useContext(FormatContext) ?? getDeviceFormatter();
}
