// Supabase Edge Function: permanently delete the calling user's account.
//
// The client cannot delete auth users (that requires the service-role key,
// which must never ship in the app). This function verifies the caller's JWT,
// removes their stored files, then deletes the auth user — every user-owned
// table cascades from auth.users, so all financial data is removed with it.
//
// Deploy: npx supabase functions deploy delete-account
import { createClient } from 'npm:@supabase/supabase-js@2';

const ATTACHMENTS_BUCKET = 'attachments';
const PAGE_SIZE = 100;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json(401, { error: 'unauthorized' });

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json(500, { error: 'server_misconfigured' });

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Identify the caller from their own JWT — never from the request body.
  const token = authHeader.slice('Bearer '.length);
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json(401, { error: 'unauthorized' });
  const userId = userData.user.id;

  // Storage objects do not cascade; remove the user's folder first.
  for (;;) {
    const { data: files, error } = await admin.storage
      .from(ATTACHMENTS_BUCKET)
      .list(userId, { limit: PAGE_SIZE });
    if (error) return json(500, { error: 'storage_cleanup_failed' });
    if (!files || files.length === 0) break;
    const { error: removeError } = await admin.storage
      .from(ATTACHMENTS_BUCKET)
      .remove(files.map((f) => `${userId}/${f.name}`));
    if (removeError) return json(500, { error: 'storage_cleanup_failed' });
    if (files.length < PAGE_SIZE) break;
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) return json(500, { error: 'delete_failed' });

  // Log only the outcome — never personal or financial data.
  console.log(JSON.stringify({ event: 'account_deleted' }));
  return json(200, { deleted: true });
});
