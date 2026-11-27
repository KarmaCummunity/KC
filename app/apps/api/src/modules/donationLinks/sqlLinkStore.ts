import type { SqlBackedClient } from '../../platform/postgrest/sqlBackedClient';
import type { LinkFields, LinkRow, LinkStore } from './donationLinkService';

/** The columns returned to the member; the generated search document stays in the database. */
const LINK_COLUMNS =
  'id, category_slug, url, display_name, description, submitted_by, validated_at, review_status, review_note, created_at, updated_at';
/** PostgreSQL foreign_key_violation: the giving world does not exist. */
const FOREIGN_KEY_VIOLATION = '23503';

/** A database refusal, kept as an Error so the service reports it and the member sees `server_error`. */
function failure(error: { code?: string; message?: string }): Error {
  return Object.assign(new Error(error.message ?? 'donation_links query failed'), { code: error.code });
}

/**
 * `public.donation_links` over the service role: members may read and delete
 * their rows, and only the server writes them, after its own checks.
 * @param service A client that acts as the service role (`PortClients.serviceClient`).
 */
export function createSqlLinkStore(service: SqlBackedClient): LinkStore {
  const links = () => service.from('donation_links');
  return {
    async find(id) {
      const { data, error } = await links().select(LINK_COLUMNS).eq('id', id).maybeSingle();
      if (error) throw failure(error);
      return data as LinkRow | null;
    },
    async update(id, fields: LinkFields) {
      const { data, error } = await links().update(fields).eq('id', id).select(LINK_COLUMNS).single();
      if (error) throw failure(error);
      return data as LinkRow | null;
    },
    async countSince(userId, sinceIso) {
      const { count, error } = await links().select('id', { count: 'exact', head: true }).eq('submitted_by', userId).gte('created_at', sinceIso);
      if (error) throw failure(error);
      return count ?? 0;
    },
    async insert(fields: LinkFields) {
      const { data, error } = await links().insert(fields).select(LINK_COLUMNS).single();
      if (error?.code === FOREIGN_KEY_VIOLATION) return 'unknown_category';
      if (error) throw failure(error);
      return data as LinkRow | null;
    },
  };
}
