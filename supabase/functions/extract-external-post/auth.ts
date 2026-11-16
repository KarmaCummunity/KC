// supabase/functions/extract-external-post/auth.ts
// Verifies the caller's JWT server-side (auth.getUser) and reads when the account was created,
// which the account-age limit needs (FR-IMPORT-008 AC4).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import type { AuthedMember } from './handler.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

export async function authenticate(req: Request): Promise<AuthedMember | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) return null;
  const created = data.user.created_at ? new Date(data.user.created_at) : null;
  return { id: data.user.id, createdAt: created && !Number.isNaN(created.getTime()) ? created : null };
}
