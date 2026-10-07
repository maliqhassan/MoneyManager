import type { SupabaseClient } from '@supabase/supabase-js';

import type { SyncTableName } from './registry';
import type { ChangeCursor, RemoteDataSource, RemoteRow, RemoteWriteAck } from './types';

const ACK_COLUMNS = 'id, version, updated_at';

interface AckRow {
  version: number;
  updated_at: string;
}

function toAck(rows: AckRow[] | null): RemoteWriteAck | null {
  const row = rows?.[0];
  return row ? { version: row.version, updatedAt: row.updated_at } : null;
}

/** Double-quotes a value for use inside a PostgREST `or=(...)` filter. */
function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Supabase (PostgREST) implementation of the sync remote. Row Level Security
 * restricts every query to the signed-in user's rows; `user_id` filters are
 * added as well so queries use the (user_id, updated_at) indexes.
 */
export function createSupabaseRemote(
  supabase: SupabaseClient,
  getUserId: () => string,
): RemoteDataSource {
  return {
    async insert(table: SyncTableName, row: Record<string, unknown>) {
      const { data, error } = await supabase
        .from(table)
        .upsert(row, { onConflict: 'id', ignoreDuplicates: true })
        .select(ACK_COLUMNS);
      if (error) throw error;
      return toAck(data as AckRow[] | null);
    },

    async updateIfVersion(
      table: SyncTableName,
      id: string,
      row: Record<string, unknown>,
      expectedVersion: number,
    ) {
      const { id: _ignored, user_id: _owner, created_at: _created, ...changes } = row;
      const { data, error } = await supabase
        .from(table)
        .update(changes)
        .eq('id', id)
        .eq('version', expectedVersion)
        .select(ACK_COLUMNS);
      if (error) throw error;
      return toAck(data as AckRow[] | null);
    },

    async fetchById(table: SyncTableName, id: string) {
      const { data, error } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      return (data as RemoteRow | null) ?? null;
    },

    async fetchChanges(table: SyncTableName, since: ChangeCursor | null, limit: number) {
      let query = supabase.from(table).select('*').eq('user_id', getUserId());
      if (since && !since.id) {
        // Rewound cursor (overlap window): re-read everything from that instant.
        query = query.gte('updated_at', since.updatedAt);
      } else if (since) {
        const ts = quote(since.updatedAt);
        query = query.or(`updated_at.gt.${ts},and(updated_at.eq.${ts},id.gt.${quote(since.id)})`);
      }
      const { data, error } = await query
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit);
      if (error) throw error;
      return (data as RemoteRow[] | null) ?? [];
    },
  };
}
