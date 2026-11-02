// #1412 — a listing card shows its publisher (docs/spec/07 §7.4). Against the local Supabase
// stack, a guest reading cards gets the owner's display name through the `users` embed: the
// embed hint names a real foreign key, and `users` RLS lets a guest read an active owner.
// Collected only when the stack credentials are set (vitest.config.ts, ci-backend).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIntegrationClient } from '../../__tests__/integrationSupabaseClient';
import { SupabaseMarketplaceRepository } from '../SupabaseMarketplaceRepository';

// Seeding an auth user and a listing takes a few hundred ms per step on the stack.
const CASE_TIMEOUT_MS = 30_000;
const DISPLAY_NAME = 'card publisher';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — export the running stack with \`supabase status -o env\``);
  return value;
}

describe('listing card publisher (local stack)', () => {
  const url = requireEnv('SUPABASE_URL');
  const admin = createIntegrationClient(url, requireEnv('SUPABASE_SERVICE_ROLE_KEY'));
  let ownerId: string | null = null;
  let listingId = '';

  beforeAll(async () => {
    const { data: created, error: userError } = await admin.auth.admin.createUser({
      email: `card-publisher-${crypto.randomUUID().slice(0, 8)}@kc.test`,
      password: 'contract-p4ssword!!',
      email_confirm: true,
    });
    if (userError || !created.user) throw new Error(`createUser failed (${userError?.message})`);
    ownerId = created.user.id;
    const { error: profileError } = await admin
      .from('users')
      .update({ account_status: 'active', display_name: DISPLAY_NAME })
      .eq('user_id', ownerId);
    if (profileError) throw new Error(`profile update failed (${profileError.message})`);

    const { data: kind, error: kindError } = await admin
      .from('listing_kinds')
      .select('kind_id')
      .eq('slug', 'give_item')
      .single();
    if (kindError || !kind) throw new Error(`no give_item kind (${kindError?.message})`);
    const { data: listing, error: listingError } = await admin
      .from('listings')
      .insert({ owner_id: ownerId, world_slug: 'items', kind_id: kind.kind_id, direction: 'give', title: 'Card publisher chair' })
      .select('listing_id')
      .single();
    if (listingError || !listing) throw new Error(`listing insert failed (${listingError?.message})`);
    listingId = listing.listing_id;
  }, CASE_TIMEOUT_MS);

  afterAll(async () => {
    // Deleting the auth user cascades to public.users and the owner's listings.
    if (ownerId) await admin.auth.admin.deleteUser(ownerId).catch(() => undefined);
  });

  it('gives a guest the publisher of a public listing', async () => {
    const guest = createIntegrationClient(url, requireEnv('SUPABASE_ANON_KEY'));
    const [card] = await new SupabaseMarketplaceRepository(guest).getListingCards([listingId]);
    expect(card?.listingId).toBe(listingId);
    expect(card?.publisher).toEqual({ displayName: DISPLAY_NAME, avatarUrl: null });
  }, CASE_TIMEOUT_MS);
});
