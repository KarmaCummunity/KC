// Mapped to spec: FR-POST-003 / FR-POST-009 / FR-POST-021 — the exposure settings of the listing form:
// who may see the listing, how much of the address it shows, and whether the counterparty sees who
// published it. A new listing starts from the member's usual defaults; an edit or a republish starts
// from the source listing. The audience is a column of the post (written by create / update); the
// identity mask lives in the owner's actor-identity row, saved the same way the items form saves it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LocationDisplayLevel, MarketplaceListingDetail, PostVisibility } from '@kc/domain';
import { POST_DRAFT_DEFAULTS } from '../lib/postDraftFormState';
import { syncOwnerPostActorIdentity } from '../lib/syncOwnerPostActorIdentity';
import { getPostRepo } from '../services/postsComposition';
import { getUserRepo } from '../services/userComposition';

interface Args {
  /** The listing being edited or republished; null for a blank form. */
  readonly sourceListingId: string | null;
  /** The loaded source listing, when there is one. */
  readonly sourceDetail: MarketplaceListingDetail | undefined;
  /** Editing keeps the same post: its identity row is read so the mask shows as it is. */
  readonly editListingId: string | null;
  readonly userId: string | null;
}

/** Query key of a post's actor-identity rows; shared with the post screens that read the same rows. */
export const postActorIdentityQueryKey = (postId: string | null) => ['post-actor-identity', postId] as const;

export function useListingExposure({ sourceListingId, sourceDetail, editListingId, userId }: Args) {
  const [visibility, setVisibility] = useState<PostVisibility>('Public');
  const [locationDisplayLevel, setLocationDisplayLevel] = useState<LocationDisplayLevel>(POST_DRAFT_DEFAULTS.locationDisplayLevel);
  const [hideFromCounterparty, setHide] = useState(false);
  const hydratedFor = useRef<string | null>(null);
  /** The member changed the mask: a late-arriving stored value must not overwrite that choice. */
  const hideTouched = useRef(false);

  const profileQuery = useQuery({
    queryKey: ['user-profile', userId],
    queryFn: () => getUserRepo().findById(userId!),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
  });
  const profilePrivacy = profileQuery.data?.privacyMode ?? 'Public';
  // Only a private profile may limit a post to followers. A new listing (or a republish) whose
  // source was followers-only falls back to public for a public profile; an edit keeps what is
  // stored (a profile turned public later never rewrites existing posts — FR-POST-009 AC4). The
  // profile must be loaded first: until then "public" is only a placeholder.
  const profileKnown = profileQuery.data !== undefined && profileQuery.data !== null;
  useEffect(() => {
    if (editListingId || !profileKnown) return;
    if (profilePrivacy === 'Public' && visibility === 'FollowersOnly') setVisibility('Public');
  }, [editListingId, profileKnown, profilePrivacy, visibility]);

  // Start from the source listing, once per source.
  useEffect(() => {
    if (!sourceDetail || hydratedFor.current === sourceDetail.listingId) return;
    hydratedFor.current = sourceDetail.listingId;
    if (sourceDetail.visibility) setVisibility(sourceDetail.visibility);
    if (sourceDetail.locationDisplayLevel) setLocationDisplayLevel(sourceDetail.locationDisplayLevel);
  }, [sourceDetail]);

  const identityQuery = useQuery({
    queryKey: postActorIdentityQueryKey(sourceListingId),
    queryFn: () => getPostRepo().listPostActorIdentities(sourceListingId!),
    enabled: Boolean(sourceListingId && userId),
    staleTime: 60_000,
  });
  const identityLoaded = useRef<string | null>(null);
  useEffect(() => {
    if (!sourceListingId || !userId || !identityQuery.data || identityLoaded.current === sourceListingId) return;
    identityLoaded.current = sourceListingId;
    if (hideTouched.current) return;
    setHide(identityQuery.data.find((row) => row.userId === userId)?.hideFromCounterparty ?? false);
  }, [identityQuery.data, sourceListingId, userId]);

  const setHideFromCounterparty = useCallback((next: boolean) => {
    hideTouched.current = true;
    setHide(next);
  }, []);

  /**
   * Saves the owner's mask after the post is written. A new post needs a row only when it is masked
   * ("only me" always masks); an edit also rewrites an existing row so it follows the new audience.
   */
  const saveIdentity = async (postId: string): Promise<void> => {
    if (!userId) return;
    if (editListingId) {
      await syncOwnerPostActorIdentity({ postId, ownerId: userId, visibility, hideFromCounterparty });
      return;
    }
    const hide = hideFromCounterparty || visibility === 'OnlyMe';
    if (hide) await getPostRepo().upsertPostActorIdentity({ postId, userId, surfaceVisibility: visibility, hideFromCounterparty: true });
  };

  return {
    profilePrivacy,
    visibility,
    setVisibility,
    locationDisplayLevel,
    setLocationDisplayLevel,
    hideFromCounterparty,
    setHideFromCounterparty,
    saveIdentity,
    /** An edit waits for the stored mask, so saving early never overwrites it with the default. */
    loading: Boolean(editListingId) && identityQuery.isLoading,
  };
}
