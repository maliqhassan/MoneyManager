import type { Attachment } from '@/domain/models';
import type { SqlDatabase } from '@/database/types';
import { AppError } from '@/lib/errors';
import { type ReceiptFile, receiptFileSchema } from '@/validation/transactions';

import type { AttachmentRepository } from '../types';
import { type AttachmentRow, toAttachment } from './mappers';
import { insertSynced, type RepositoryContext, updateSynced, validate } from './shared';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/**
 * Receipt metadata. The row syncs through the normal outbox (offline-safe);
 * the file itself uploads separately to the private bucket at
 * `<user_id>/<attachment_id>.<ext>` (see services/receipts/uploader).
 * `local_uri` / `upload_status` are device-local and never synced.
 */
export class SqliteAttachmentRepository implements AttachmentRepository {
  constructor(
    private readonly db: SqlDatabase,
    private readonly ctx: RepositoryContext,
  ) {}

  async add(transactionId: string, file: ReceiptFile): Promise<Attachment> {
    const valid = validate(receiptFileSchema, file);
    const id = this.ctx.newId();
    await this.db.transaction(async (tx) => {
      const owner = await tx.getFirst<{ id: string }>(
        `SELECT id FROM transactions WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
        [transactionId, this.ctx.userId],
      );
      if (!owner) throw new AppError('not_found', 'Transaction not found');
      await insertSynced(tx, this.ctx, 'attachments', id, {
        transaction_id: transactionId,
        storage_path: `${this.ctx.userId}/${id}.${EXTENSIONS[valid.mimeType] ?? 'bin'}`,
        mime_type: valid.mimeType,
        size_bytes: valid.sizeBytes,
        file_name: valid.fileName,
        local_uri: valid.localUri,
        upload_status: 'pending',
      });
    });
    this.ctx.onChange('attachments');
    const row = await this.db.getFirst<AttachmentRow>(`SELECT * FROM attachments WHERE id = ?`, [
      id,
    ]);
    return toAttachment(row!);
  }

  async remove(id: string): Promise<void> {
    await this.db.transaction((tx) =>
      updateSynced(tx, this.ctx, 'attachments', id, { deleted_at: this.ctx.now() }, 'delete'),
    );
    this.ctx.onChange('attachments');
  }

  async pendingUploads(): Promise<(Attachment & { localUri: string })[]> {
    const rows = await this.db.getAll<AttachmentRow>(
      `SELECT * FROM attachments
       WHERE user_id = ? AND deleted_at IS NULL AND local_uri IS NOT NULL
         AND upload_status IN ('pending', 'failed')
       ORDER BY created_at`,
      [this.ctx.userId],
    );
    return rows
      .map(toAttachment)
      .filter((a): a is Attachment & { localUri: string } => !!a.localUri);
  }

  // Upload state is device-local bookkeeping: plain UPDATEs, no outbox entry.
  async markUploaded(id: string): Promise<void> {
    await this.db.run(`UPDATE attachments SET upload_status = 'uploaded' WHERE id = ?`, [id]);
    this.ctx.onChange('attachments');
  }

  async markUploadFailed(id: string): Promise<void> {
    await this.db.run(`UPDATE attachments SET upload_status = 'failed' WHERE id = ?`, [id]);
  }
}
