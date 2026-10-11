import { create } from 'zustand';

import type { ParsedCsv } from '@/domain/csv/csv';
import type { ImportMapping, PlanRow } from '@/domain/imports/plan';
import type { ImportRunResult } from '@/repositories/types';
import type { PickedCsv } from '@/services/data/dataFiles';

import type { ImportSelections } from './importPlanner';

export const IMPORT_STEPS = [
  'file',
  'columns',
  'formats',
  'mapping',
  'review',
  'importing',
  'done',
] as const;
export type ImportStep = (typeof IMPORT_STEPS)[number];

/** In-progress import (memory only; the CSV text is never persisted). */
export interface ImportState {
  step: ImportStep;
  file: PickedCsv | null;
  parsed: ParsedCsv | null;
  mapping: ImportMapping;
  selections: ImportSelections;
  plan: PlanRow[] | null;
  progress: { done: number; total: number } | null;
  result: ImportRunResult | null;
  set: (patch: Partial<Omit<ImportState, 'set' | 'reset'>>) => void;
  reset: () => void;
}

export const EMPTY_MAPPING: ImportMapping = {
  columns: {},
  amountMode: 'signed',
  negativeMeans: 'expense',
  dateFormat: null,
  decimal: '.',
  transferRows: 'skip',
};

export const EMPTY_SELECTIONS: ImportSelections = {
  targetAccountId: null,
  accountMap: {},
  categoryMap: {},
  fallback: { expense: null, income: null },
};

const INITIAL = {
  step: 'file' as ImportStep,
  file: null,
  parsed: null,
  mapping: EMPTY_MAPPING,
  selections: EMPTY_SELECTIONS,
  plan: null,
  progress: null,
  result: null,
};

export const useImportStore = create<ImportState>()((set) => ({
  ...INITIAL,
  set: (patch) => set(patch),
  reset: () => set(INITIAL),
}));
