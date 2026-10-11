import { useMemo } from 'react';
import { create } from 'zustand';

import {
  type DateRange,
  normalizeRange,
  type ReportPeriodPreset,
  resolveReportPeriod,
  type ResolvedPeriod,
} from '@/domain/reports/periods';
import { useFormatter } from '@/i18n/FormatContext';

/**
 * Selected reporting period (UI state, kept while switching tabs; not
 * persisted). Changing the period leaves every other report state alone.
 */
interface ReportPeriodState {
  preset: ReportPeriodPreset;
  custom: DateRange | null;
  setPreset: (preset: ReportPeriodPreset) => void;
  /** Stores a custom range, always ordered (start ≤ end). */
  setCustom: (start: string, end: string) => void;
  reset: () => void;
}

export const useReportPeriodStore = create<ReportPeriodState>()((set) => ({
  preset: 'this_month',
  custom: null,
  setPreset: (preset) => set({ preset }),
  setCustom: (start, end) => set({ preset: 'custom', custom: normalizeRange(start, end) }),
  reset: () => set({ preset: 'this_month', custom: null }),
}));

/** The selected period resolved for the user's time zone and first day of week. */
export function useReportPeriod(): ResolvedPeriod {
  const formatter = useFormatter();
  const preset = useReportPeriodStore((s) => s.preset);
  const custom = useReportPeriodStore((s) => s.custom);
  const today = formatter.today();
  const firstDayOfWeek = formatter.settings.firstDayOfWeek;
  return useMemo(
    () => resolveReportPeriod(preset, today, firstDayOfWeek, custom),
    [preset, today, firstDayOfWeek, custom],
  );
}
