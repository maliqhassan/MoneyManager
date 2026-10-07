import type { SupabaseClient } from '@supabase/supabase-js';
import { File } from 'expo-file-system';

import type { AttachmentRepository } from '@/repositories/types';
import { logger } from '@/services/monitoring/logger';

export const RECEIPTS_BUCKET = 'attachments';

let running: Promise<number> | null = null;

/**
 * Uploads receipt files whose rows were saved offline. Runs after a
 * successful sync (the row must exist server-side for the storage policy
 * path check to be meaningful). Failures stay queued and retry next time;
 * the transaction itself is never affected. Single flight.
 */
export function uploadPendingReceipts(
  attachments: AttachmentRepository,
  supabase: SupabaseClient,
): Promise<number> {
  running ??= (async () => {
    let uploaded = 0;
    for (const attachment of await attachments.pendingUploads()) {
      try {
        const file = new File(attachment.localUri);
        if (!file.exists) {
          await attachments.markUploadFailed(attachment.id);
          continue;
        }
        const { error } = await supabase.storage
          .from(RECEIPTS_BUCKET)
          .upload(attachment.storagePath, await file.arrayBuffer(), {
            contentType: attachment.mimeType,
            upsert: true,
          });
        if (error) throw error;
        await attachments.markUploaded(attachment.id);
        uploaded += 1;
      } catch (error) {
        logger.warn('Receipt upload failed; will retry', { attachmentId: attachment.id });
        logger.debug('Receipt upload error', { error });
        await attachments.markUploadFailed(attachment.id);
      }
    }
    return uploaded;
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Short-lived signed URL for a receipt stored in the private bucket. */
export async function receiptSignedUrl(
  supabase: SupabaseClient,
  storagePath: string,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(RECEIPTS_BUCKET)
    .createSignedUrl(storagePath, 600);
  return error ? null : data.signedUrl;
}
