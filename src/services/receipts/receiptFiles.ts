import { Directory, File, Paths } from 'expo-file-system';

import { newId } from '@/lib/ids';
import { RECEIPT_MIME_TYPES, type ReceiptFile } from '@/validation/transactions';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

function receiptsDirectory(): Directory {
  const dir = new Directory(Paths.document, 'receipts');
  dir.create({ idempotent: true, intermediates: true });
  return dir;
}

/**
 * Copies a picked file (camera roll / camera cache, which the OS may purge)
 * into the app's document directory so it survives until uploaded.
 * Returns the metadata the repository validates (type and ≤ 10 MB).
 */
export async function persistReceipt(source: {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
}): Promise<ReceiptFile> {
  const mimeType = (source.mimeType ?? 'image/jpeg').toLowerCase();
  const extension = EXTENSIONS[mimeType] ?? 'bin';
  const destination = new File(receiptsDirectory(), `${newId()}.${extension}`);
  await new File(source.uri).copy(destination);
  return {
    localUri: destination.uri,
    mimeType: (RECEIPT_MIME_TYPES as readonly string[]).includes(mimeType)
      ? (mimeType as ReceiptFile['mimeType'])
      : (mimeType as never),
    sizeBytes: destination.size ?? source.fileSize ?? 0,
    fileName: source.fileName ?? `receipt.${extension}`,
  };
}

export function deleteLocalReceipt(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Best effort: a missing local copy is not an error.
  }
}
