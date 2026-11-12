import type { SupabaseClient } from '@supabase/supabase-js';
import type { IMarketplaceRepository, MarketplacePage, MyListingsCursor } from '@kc/application';
import { BackendRuleError, POST_STATUSES, type ListingKindOption, type MarketplaceSimilarListing, type MyListingRow, type ProfileListingRow } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { openDirectChat } from '../chat/supabaseDmChat';
import { sessionUserId } from '../users/userReads';
import { decodePageCursor, encodePageCursor } from '../posts/pageCursor';
import { clampPageLimit } from '../posts/postCardPages';
import { fetchListingDetail } from './mapListingDetail';
import { searchExternalBodies } from './mapExternalBody';
import { listWorldSubcategories } from './listWorldSubcategories';
import { listKindOptions, loadKindCatalog } from './kindCatalog';
import { cardToMyListingRow, cardToProfileListingRow, cardToSimilarListing, fetchCardsInOrder } from './listingMapping';
import { createListing } from './listingWrites';
import * as handoffs from './givingHandoffs';
import * as events from './eventRegistrations';
import * as owner from './listingOwnerActions';

type Client = SupabaseClient<Database>;

/** "My listings" shows every status of the owner's posts but an unpublished draft. */
const MY_LISTING_STATUSES = POST_STATUSES.filter((status) => status !== 'draft');

/** A listing is a post: the marketplace screens' repository over the baseline's post functions. */
export class SupabaseMarketplaceRepository implements IMarketplaceRepository {
  constructor(private readonly client: Client) {}

  getListingDetail = (listingId: string) => fetchListingDetail(this.client, listingId);

  /** "More like this": posts of the same world nearest in meaning, as `similar_posts` cards. */
  async similarListings(listingId: string, limit = 6): Promise<MarketplaceSimilarListing[]> {
    const cards = unwrapCall('rpc:similar_posts', await this.client.rpc('similar_posts', { p_post_id: listingId, p_limit: limit }));
    const kinds = await loadKindCatalog(this.client);
    return (cards ?? []).map((card) => cardToSimilarListing(card, kinds));
  }

  listKindsForWorld = (worldSlug: string): Promise<ListingKindOption[]> => listKindOptions(this.client, worldSlug);

  searchExternalBodies = (worldSlug: string, query?: string | null, limit?: number) =>
    searchExternalBodies(this.client, worldSlug, query, limit);

  listWorldSubcategories = (worldSlug: string) => listWorldSubcategories(this.client, worldSlug);

  createListing = (input: Parameters<IMarketplaceRepository['createListing']>[0]) => createListing(this.client, input);

  /** Opens (or reuses) the direct chat with the listing's owner anchored to the post, and sends the opener. */
  async startChat(listingId: string, openingMessage?: string | null): Promise<string> {
    const [card] = await fetchCardsInOrder(this.client, [listingId]);
    if (!card?.owner_id) throw new BackendRuleError('post_unavailable', 'rpc:post_cards');
    const chat = await openDirectChat(this.client, card.owner_id, { postId: listingId });
    const body = openingMessage?.trim();
    if (body) {
      unwrapCall('rpc:send_message', await this.client.rpc('send_message', { p_chat_id: chat.chatId, p_body: body }));
    }
    return chat.chatId;
  }

  /** The caller's own listings of any status but draft, newest first: the owner-only `mine` tab of `profile_posts_page`. */
  async listMyListingsPage(
    limit: number,
    cursor?: MyListingsCursor | null,
  ): Promise<MarketplacePage<MyListingRow, MyListingsCursor>> {
    const userId = await sessionUserId(this.client);
    if (!userId) return { rows: [], nextCursor: null };
    const size = clampPageLimit(limit);
    const [found, kinds] = await Promise.all([
      this.client.rpc('profile_posts_page', {
        p_user_id: userId,
        p_tab: 'mine',
        p_statuses: MY_LISTING_STATUSES,
        p_cursor: decodePageCursor(cursor) ?? undefined,
        p_limit: size,
      }),
      loadKindCatalog(this.client),
    ]);
    const rows = unwrapCall('rpc:profile_posts_page', found) ?? [];
    const last = rows[rows.length - 1];
    return {
      rows: rows.map((row) => cardToMyListingRow(row.card, kinds)),
      nextCursor: rows.length >= size && last ? encodePageCursor(last.next_cursor) : null,
    };
  }

  /** A member's open listings, as the profile's `open` tab shows them. */
  async listProfileListings(ownerId: string, limit = 24): Promise<ProfileListingRow[]> {
    const rows = unwrapCall(
      'rpc:profile_posts_page',
      await this.client.rpc('profile_posts_page', { p_user_id: ownerId, p_tab: 'open', p_limit: clampPageLimit(limit) }),
    );
    const kinds = await loadKindCatalog(this.client);
    return (rows ?? []).map((row) => cardToProfileListingRow(row.card, kinds));
  }

  // Owner lifecycle (spec 07 §7.1 "Owner management") — see listingOwnerActions.ts.
  updateMyListing = (listingId: string, patch: Parameters<IMarketplaceRepository['updateMyListing']>[1]) =>
    owner.updateMyListing(this.client, listingId, patch);
  pauseMyListing = (listingId: string) => owner.runOwnerAction(this.client, 'pause', listingId);
  resumeMyListing = (listingId: string) => owner.runOwnerAction(this.client, 'resume', listingId);
  fulfillMyListing = (listingId: string) => owner.runOwnerAction(this.client, 'fulfill', listingId);
  deleteMyListing = (listingId: string) => owner.runOwnerAction(this.client, 'delete', listingId);
  addMyListingMedia = (listingId: string, media: Parameters<IMarketplaceRepository['addMyListingMedia']>[1]) =>
    owner.addMyListingMedia(this.client, listingId, media);

  // Items/food handoffs — see givingHandoffs.ts.
  getListingHandoff = (listingId: string) => handoffs.getListingHandoff(this.client, listingId);
  listMyGivingHandoffs = (limit?: number) => handoffs.listMyGivingHandoffs(this.client, limit);
  reserveItemGiving = (
    listingId: string,
    pickupMode?: 'pickup' | 'delivery',
    start?: string | null,
    end?: string | null,
  ) => handoffs.reserveItemGiving(this.client, listingId, pickupMode, start, end);
  confirmItemHandoff = (id: string) => handoffs.confirmItemHandoff(this.client, id);
  claimFoodGiving = (listingId: string, start?: string | null, end?: string | null) =>
    handoffs.claimFoodGiving(this.client, listingId, start, end);
  cancelGivingHandoff = (id: string) => handoffs.cancelGivingHandoff(this.client, id);
  markGivingHandedOver = (id: string) => handoffs.markGivingHandedOver(this.client, id);
  rateGivingHandoff = (id: string, rating: number, comment?: string | null) =>
    handoffs.rateGivingHandoff(this.client, id, rating, comment);

  // Organization events — see eventRegistrations.ts.
  registerForEvent = (target: string) => events.registerForEvent(this.client, target);
  decideEventRegistration = (id: string, approve: boolean) => events.decideEventRegistration(this.client, id, approve);
  cancelEventRegistration = (id: string) => events.cancelEventRegistration(this.client, id);
  markEventAttendance = (id: string, attended: boolean) => events.markEventAttendance(this.client, id, attended);
  listEventRegistrations = (target: string) => events.listEventRegistrations(this.client, target);
  getMyEventRegistration = (postId: string) => events.getMyEventRegistration(this.client, postId);
  listMyOrganizations = () => events.listMyOrganizations(this.client);
  messageEventRegistrants = (postId: string, body: string) => events.messageEventRegistrants(this.client, postId, body);
}
