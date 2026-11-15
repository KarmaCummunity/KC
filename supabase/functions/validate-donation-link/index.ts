// validate-donation-link — members suggest and edit donation links (FR-DONATE-007/008/009).
// Wiring only: the protocol is in handler.ts and the address check in ssrf.ts. The caller
// is identified with their own session; `public.donation_links` is written as the service
// role (a device may only read and delete its rows).
// Secrets (names): SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { reportError, withObservability } from '../_shared/observability/mod.ts';
import { createDonationLinkHandler, type LinkRow, type LinkStore } from './handler.ts';
import { checkReachable } from './ssrf.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

/** The columns returned to the member; the generated search document stays in the database. */
const LINK_COLUMNS =
  'id, category_slug, url, display_name, description, submitted_by, validated_at, review_status, review_note, created_at, updated_at';
/** PostgreSQL foreign_key_violation: the giving world does not exist. */
const FOREIGN_KEY_VIOLATION = '23503';

const links: LinkStore = {
  async find(id) {
    const { data, error } = await admin.from('donation_links').select(LINK_COLUMNS).eq('id', id).maybeSingle();
    if (error) throw error;
    return data as LinkRow | null;
  },
  async update(id, fields) {
    const { data, error } = await admin.from('donation_links').update(fields).eq('id', id).select(LINK_COLUMNS).single();
    if (error) throw error;
    return data as LinkRow | null;
  },
  async countSince(userId, sinceIso) {
    const { count, error } = await admin
      .from('donation_links')
      .select('id', { count: 'exact', head: true })
      .eq('submitted_by', userId)
      .gte('created_at', sinceIso);
    if (error) throw error;
    return count ?? 0;
  },
  async insert(fields) {
    const { data, error } = await admin.from('donation_links').insert(fields).select(LINK_COLUMNS).single();
    if (error?.code === FOREIGN_KEY_VIOLATION) return 'unknown_category';
    if (error) throw error;
    return data as LinkRow | null;
  },
};

Deno.serve(withObservability('validate-donation-link', createDonationLinkHandler({
  async authenticate(authorization) {
    // The caller's own session: the token is verified by Auth, never decoded here.
    const session = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data, error } = await session.auth.getUser();
    if (error || !data?.user) return null;
    const roles = await session.rpc('get_my_admin_roles');
    const held = Array.isArray(roles.data) ? (roles.data as string[]) : [];
    return { userId: data.user.id, isSuperAdmin: held.includes('super_admin') };
  },
  checkReachable: (url) => checkReachable(url),
  links,
  report: (error, stage) => reportError(error, { fn: 'validate-donation-link', tags: { stage } }),
})));
