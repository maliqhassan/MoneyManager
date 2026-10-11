import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { strToU8, zipSync } from 'fflate';

import { type ExportTable, manifestJson, readmeText, renderTable } from '@/domain/exports/export';
import type { BuiltExport } from '@/features/data/exportBuilder';
import { AppError } from '@/lib/errors';

/**
 * File handling for import/export. Files stay on the device:
 * - the picked CSV is COPIED into the app cache by the system picker (the
 *   user's original is never modified or deleted) and our copy is removed
 *   after the import;
 * - exports are written to the app cache and handed to the system share
 *   sheet (the user chooses where they go); old exports are cleaned up.
 * No file content is uploaded or logged.
 */

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export interface PickedCsv {
  name: string;
  uri: string;
  size: number | null;
}

/** Opens the system file picker for a CSV file; null when cancelled. */
export async function pickCsvFile(): Promise<PickedCsv | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  return { name: asset.name, uri: asset.uri, size: asset.size ?? null };
}

/** Reads the picked copy as text (UTF-8), refusing oversized files. */
export async function readCsvText(file: PickedCsv): Promise<string> {
  const handle = new File(file.uri);
  const size = handle.size ?? file.size ?? 0;
  if (size > MAX_IMPORT_BYTES) {
    throw new AppError('validation', 'File too large', {
      fieldErrors: { file: 'dataImport.errors.tooLarge' },
    });
  }
  return handle.text();
}

/** Deletes OUR cached copy of a picked file (never the user's original). */
export function discardPickedCopy(file: PickedCsv): void {
  try {
    if (!file.uri.startsWith(Paths.cache.uri)) return;
    const handle = new File(file.uri);
    if (handle.exists) handle.delete();
  } catch {
    // Best effort: the OS also clears the cache.
  }
}

function exportsDirectory(): Directory {
  const dir = new Directory(Paths.cache, 'exports');
  if (dir.exists) {
    // Only the newest export is kept.
    for (const entry of dir.list()) {
      try {
        entry.delete();
      } catch {
        // ignore
      }
    }
  }
  dir.create({ idempotent: true, intermediates: true });
  return dir;
}

export interface WrittenExport {
  uri: string;
  fileName: string;
  mimeType: string;
  files: string[];
}

/**
 * Writes the export: a single CSV when it is just transactions with no
 * related files, otherwise a ZIP with every table plus README.txt and
 * manifest.json.
 */
export function writeExport(built: BuiltExport, stamp: string): WrittenExport {
  const dir = exportsDirectory();
  const nonEmptyRelated = built.tables.filter((t) => t.file !== 'transactions.csv');
  if (nonEmptyRelated.length === 0) {
    const table = built.tables[0] as ExportTable;
    const fileName = `moneymanager-transactions-${stamp}.csv`;
    const file = new File(dir, fileName);
    file.write(renderTable(table));
    return { uri: file.uri, fileName, mimeType: 'text/csv', files: [table.file] };
  }
  const entries: Record<string, Uint8Array> = {
    'README.txt': strToU8(readmeText(built.manifest)),
    'manifest.json': strToU8(manifestJson(built.manifest)),
  };
  for (const t of built.tables) entries[t.file] = strToU8(renderTable(t));
  const fileName = `moneymanager-export-${stamp}.zip`;
  const file = new File(dir, fileName);
  file.write(zipSync(entries, { level: 6 }));
  return { uri: file.uri, fileName, mimeType: 'application/zip', files: Object.keys(entries) };
}

/** Opens the system share sheet for an export. */
export async function shareExport(written: WrittenExport, dialogTitle: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new AppError('storage', 'Sharing is not available on this device');
  }
  await Sharing.shareAsync(written.uri, {
    mimeType: written.mimeType,
    dialogTitle,
    UTI:
      written.mimeType === 'application/zip'
        ? 'public.zip-archive'
        : 'public.comma-separated-values-text',
  });
}
