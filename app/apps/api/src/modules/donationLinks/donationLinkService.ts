// A member suggests (FR-DONATE-007/008) or edits (FR-DONATE-009) a link to an
// organization's donation page. The server checks that the address is
// reachable (`reachability.ts`) and writes `public.donation_links` as the
// service role, because a member may only read and delete their rows. The
// database sends every new or edited link back to review; the giving world is
// checked by the table's foreign key.
//
// Ported from `supabase/functions/validate-donation-link/handler.ts`: same
// input, same answers, same rules.

import { isSafeHost, parseUrl } from './addressSafety';

/** The caller as this service sees them. */
export interface LinkMember {
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
  readonly checkReachable: (url: URL) => Promise<boolean>;
  readonly links: LinkStore;
  /** Records a failure that is the server's (for the log); the member only sees `server_error`. */
  readonly report: (error: unknown, stage: 'insert' | 'update') => void;
  /** The clock; injectable for tests. */
  readonly now?: () => Date;
}

export type DonationLinkFailure = 'invalid_input' | 'invalid_url' | 'unreachable' | 'forbidden' | 'unauthorized' | 'rate_limited' | 'server_error';
export type DonationLinkAnswer = { readonly ok: true; readonly link: LinkRow } | { readonly ok: false; readonly code: DonationLinkFailure };

/** Links one member may add per hour. */
export const MAX_LINKS_PER_HOUR = 10;

const fail = (code: DonationLinkFailure): DonationLinkAnswer => ({ ok: false, code });

interface LinkInput {
  readonly linkId: string;
  readonly slug: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly url: URL;
}

/** Validates the body; returns the input, or the failure to answer with. */
function parseInput(body: Readonly<Record<string, unknown>>): LinkInput | DonationLinkFailure {
  const slug = typeof body.category_slug === 'string' ? body.category_slug : '';
  const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : '';
  const description = body.description == null ? null : String(body.description).trim();
  if (!slug || displayName.length < 2 || displayName.length > 80) return 'invalid_input';
  if (description !== null && description.length > 280) return 'invalid_input';
  const url = parseUrl(body.url);
  // Private, loopback and metadata hosts and odd ports are refused before any fetch.
  if (!url || !isSafeHost(url).ok) return 'invalid_url';
  const linkId = typeof body.link_id === 'string' ? body.link_id.trim() : '';
  return { linkId, slug, displayName, description: description || null, url };
}

/** Edits a link the caller owns (or any link, for the super admin). */
async function edit(member: LinkMember, input: LinkInput, fields: LinkFields, links: LinkStore): Promise<DonationLinkAnswer> {
  const existing = await links.find(input.linkId);
  if (!existing || existing.category_slug !== input.slug) return fail('invalid_input');
  if (existing.submitted_by !== member.userId && !member.isSuperAdmin) return fail('forbidden');
  const updated = await links.update(input.linkId, fields);
  return updated ? { ok: true, link: updated } : fail('server_error');
}

/** Adds a link, within the member's hourly allowance. */
async function add(member: LinkMember, fields: LinkFields, links: LinkStore, now: Date): Promise<DonationLinkAnswer> {
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  if ((await links.countSince(member.userId, hourAgo)) >= MAX_LINKS_PER_HOUR) return fail('rate_limited');
  const inserted = await links.insert({ ...fields, submitted_by: member.userId });
  if (inserted === 'unknown_category') return fail('invalid_input');
  return inserted ? { ok: true, link: inserted } : fail('server_error');
}

/**
 * Adds a link, or edits one when the body names a `link_id`.
 * @param member The signed-in caller, or null: a visitor is answered `unauthorized` before anything else runs.
 * @param body `{ category_slug, url, display_name, description?, link_id? }`.
 */
export async function submitDonationLink(member: LinkMember | null, body: unknown, deps: DonationLinkDeps): Promise<DonationLinkAnswer> {
  if (!member) return fail('unauthorized');
  if (!body || typeof body !== 'object') return fail('invalid_input');
  const input = parseInput(body as Readonly<Record<string, unknown>>);
  if (typeof input === 'string') return fail(input);
  if (!(await deps.checkReachable(input.url))) return fail('unreachable');

  const now = (deps.now ?? (() => new Date()))();
  const fields: LinkFields = {
    category_slug: input.slug,
    url: input.url.toString(),
    display_name: input.displayName,
    description: input.description,
    validated_at: now.toISOString(),
  };
  try {
    return input.linkId ? await edit(member, input, fields, deps.links) : await add(member, fields, deps.links, now);
  } catch (error) {
    deps.report(error, input.linkId ? 'update' : 'insert');
    return fail('server_error');
  }
}
