// Mapped to spec: FR-POST-003 / FR-POST-009 / FR-POST-021 — the exposure settings of the listing form:
// who may see the listing, how much of the address it shows, and whether the counterparty sees who
// published it. A new listing starts from the member's usual defaults; an edit or a republish starts
// from the source listing. The audience and the identity mask are saved through the post's actor
// identity row, which is also how an already published post moves its audience.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LocationDisplayLevel, MarketplaceListingDetail, PostVisibility } from '@kc/domain';
import { POST_DRAFT_DEFAULTS } from '../lib/postDraftFormState';
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

/** What a save must write to the post's identity row, or null when nothing differs from a fresh post. */
export function identityToSave(
  exposure: { visibility: PostVisibility; hideFromCounterparty: boolean },
  isEdit: boolean,
): { surfaceVisibility: PostVisibility; hideFromCounterparty: boolean } | null {
  // A new post is public and unmasked already; an edit may be moving back to that, so it always writes.
  if (!isEdit && exposure.visibility === 'Public' && !exposure.hideFromCounterparty) return null;
  return { surfaceVisibility: exposure.visibility, hideFromCounterparty: exposure.hideFromCounterparty };
}

export function useListingExposure({ sourceListingId, sourceDetail, editListingId, userId }: Args) {
  const [visibility, setVisibility] = useState<PostVisibility>('Public');
  const [locationDisplayLevel, setLocationDisplayLevel] = useState<LocationDisplayLevel>(POST_DRAFT_DEFAULTS.locationDisplayLevel);
  const [hideFromCounterparty, setHideFromCounterparty] = useState(false);
  const hydratedFor = useRef<string | null>(null);

  // A public profile cannot limit a post to followers: that choice is offered only to a private one.
  const profileQuery = useQuery({
    queryKey: ['user-profile', userId],
    queryFn: () => getUserRepo().findById(userId!),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
  });
  const profilePrivacy = profileQuery.data?.privacyMode ?? 'Public';
  // Only once the profile is known: until then "public" is a placeholder, and a followers-only listing
  // being edited must not be flipped to public on its way in.
  const profileKnown = profileQuery.data !== undefined && profileQuery.data !== null;
  useEffect(() => {
    if (profileKnown && profilePrivacy === 'Public' && visibility === 'FollowersOnly') setVisibility('Public');
  }, [profileKnown, profilePrivacy, visibility]);

  // Start from the source listing, once per source.
  useEffect(() => {
    if (!sourceDetail || hydratedFor.current === sourceDetail.listingId) return;
    hydratedFor.current = sourceDetail.listingId;
    if (sourceDetail.visibility) setVisibility(sourceDetail.visibility);
    if (sourceDetail.locationDisplayLevel) setLocationDisplayLevel(sourceDetail.locationDisplayLevel);
  }, [sourceDetail]);

  const identityQuery = useQuery({
    queryKey: ['post-actor-identity', sourceListingId],
    queryFn: () => getPostRepo().listPostActorIdentities(sourceListingId!),
    enabled: Boolean(sourceListingId && userId),
    staleTime: 60_000,
  });
  const identityLoaded = useRef<string | null>(null);
  useEffect(() => {
    if (!sourceListingId || !userId || !identityQuery.data || identityLoaded.current === sourceListingId) return;
    identityLoaded.current = sourceListingId;
    setHideFromCounterparty(identityQuery.data.find((row) => row.userId === userId)?.hideFromCounterparty ?? false);
  }, [identityQuery.data, sourceListingId, userId]);

  /** Writes the audience and the mask of `postId` when they differ from what a fresh post has. */
  const saveIdentity = async (postId: string): Promise<void> => {
    if (!userId) return;
    const toSave = identityToSave({ visibility, hideFromCounterparty }, editListingId !== null);
    if (toSave) await getPostRepo().upsertPostActorIdentity({ postId, userId, ...toSave });
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
  };
}
