// validate-donation-link — a member suggests (FR-DONATE-007/008) or edits (FR-DONATE-009) a
// link to an organization's donation page. The function checks that the address is
// reachable (SSRF-hardened, ssrf.ts) and then writes `public.donation_links` as the service
// role, because a device may only read and delete its rows
// (supabase/schemas/80_organizations/050_donation_links.sql). The database sends every new
// or edited link back to review (`review_status = pending`); the giving world is checked by
// the table's foreign key to `donation_link_categories`.
//
// POST insert: { category_slug, url, display_name, description? }
// POST update: { link_id, category_slug, url, display_name, description? }
// → 200 { ok: true, link }
// → 200 { ok: false, code: 'invalid_input' | 'invalid_url' | 'unreachable' | 'forbidden'
//                         | 'unauthorized' | 'rate_limited' (insert only) | 'server_error' }
import { parseUrl, isSafeHost } from './ssrf.ts';

/** The caller as the function sees them: the member and whether they hold the super-admin role. */
export interface Member {
  readonly userId: string;
  readonly isSuperAdmin: boolean;
}

/** The columns a member-facing answer carries (never the search document). */
export interface LinkRow {
  id: string;
  category_slug: string;
  url: string;
  display_name: string;
  description: string | null;
  submitted_by: string;
  validated_at: string;
  review_status: string;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

/** The content a write carries; `submitted_by` is set on insert only. */
export interface LinkFields {
  category_slug: string;
  url: string;
  display_name: string;
  description: string | null;
  validated_at: string;
  submitted_by?: string;
}

/** The table, over the service role. Every method rejects on a database error. */
export interface LinkStore {
  find(id: string): Promise<LinkRow | null>;
  update(id: string, fields: LinkFields): Promise<LinkRow | null>;
  /** Links this member added since `sinceIso`. */
  countSince(userId: string, sinceIso: string): Promise<number>;
  /** The new row, 'unknown_category' when the giving world does not exist, or null when nothing came back. */
  insert(fields: LinkFields): Promise<LinkRow | 'unknown_category' | null>;
}

export interface DonationLinkDeps {
  /** Resolves the member behind an `Authorization` header, or null when it is not a valid session. */
  readonly authenticate: (authorization: string) => Promise<Member | null>;
  readonly checkReachable: (url: URL) => Promise<boolean>;
  readonly links: LinkStore;
  readonly report: (error: unknown, stage: string) => Promise<void>;
  /** The clock; injectable for tests. */
  readonly now?: () => Date;
}

/** Links one member may add per hour. */
export const MAX_LINKS_PER_HOUR = 10;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
const fail = (code: string) => reply({ ok: false, code });

interface Input {
  linkId: string;
  slug: string;
  displayName: string;
  description: string | null;
  url: URL;
}

/** Validates the body; returns the input, or the failure code to answer with. */
function parseInput(body: Record<string, unknown>): Input | { code: string } {
  const slug = typeof body.category_slug === 'string' ? body.category_slug : '';
  const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : '';
  const description = body.description == null ? null : String(body.description).trim();
  if (!slug || displayName.length < 2 || displayName.length > 80) return { code: 'invalid_input' };
  if (description !== null && description.length > 280) return { code: 'invalid_input' };
  const url = parseUrl(body.url);
  // Private, loopback and metadata hosts and odd ports are refused before any fetch.
  if (!url || !isSafeHost(url).ok) return { code: 'invalid_url' };
  const linkId = typeof body.link_id === 'string' ? body.link_id.trim() : '';
  return { linkId, slug, displayName, description: description || null, url };
}

/** The handler of the function; see the header for the protocol. */
export function createDonationLinkHandler(deps: DonationLinkDeps): (req: Request) => Promise<Response> {
  const now = deps.now ?? (() => new Date());

  /** Edits a link the caller owns (or any link, for the super admin). */
  async function edit(member: Member, input: Input, fields: LinkFields): Promise<Response> {
    const existing = await deps.links.find(input.linkId);
    if (!existing || existing.category_slug !== input.slug) return fail('invalid_input');
    if (existing.submitted_by !== member.userId && !member.isSuperAdmin) return fail('forbidden');
    const updated = await deps.links.update(input.linkId, fields);
    return updated ? reply({ ok: true, link: updated }) : fail('server_error');
  }

  /** Adds a link, within the member's hourly allowance. */
  async function add(member: Member, fields: LinkFields): Promise<Response> {
    const hourAgo = new Date(now().getTime() - 60 * 60 * 1000).toISOString();
    if ((await deps.links.countSince(member.userId, hourAgo)) >= MAX_LINKS_PER_HOUR) return fail('rate_limited');
    const inserted = await deps.links.insert({ ...fields, submitted_by: member.userId });
    if (inserted === 'unknown_category') return fail('invalid_input');
    return inserted ? reply({ ok: true, link: inserted }) : fail('server_error');
  }

  return async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
    if (req.method !== 'POST') return reply({ ok: false, code: 'invalid_input' }, 405);

    const authorization = req.headers.get('Authorization') ?? '';
    const member = authorization.startsWith('Bearer ') ? await deps.authenticate(authorization) : null;
    if (!member) return fail('unauthorized');

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return fail('invalid_input');
    const input = parseInput(body as Record<string, unknown>);
    if ('code' in input) return fail(input.code);
    if (!(await deps.checkReachable(input.url))) return fail('unreachable');

    const fields: LinkFields = {
      category_slug: input.slug,
      url: input.url.toString(),
      display_name: input.displayName,
      description: input.description,
      validated_at: now().toISOString(),
    };
    try {
      return input.linkId ? await edit(member, input, fields) : await add(member, fields);
    } catch (error) {
      await deps.report(error, input.linkId ? 'update' : 'insert');
      return fail('server_error');
    }
  };
}
