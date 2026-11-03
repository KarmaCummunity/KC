import type { ClosureCandidate, PostWithOwner } from '../../ports/IPostRepository';

export function makePostWithOwner(overrides: Partial<PostWithOwner> = {}): PostWithOwner {
  return {
    postId: 'p_1',
    ownerId: 'u_1',
    ownerName: 'Test User',
    ownerAvatarUrl: null,
    ownerHandle: 'test-user',
    ownerPrivacyMode: 'Public',
    type: 'Give',
    status: 'open',
    statusBeforeAdminRemoval: null,
    visibility: 'Public',
    title: 'Test Post',
    description: null,
    category: 'Other',
    address: { city: 'tel-aviv', cityName: 'תל אביב', street: 'Allenby', streetNumber: '10' },
    locationDisplayLevel: 'CityAndStreet',
    itemCondition: 'Good',
    urgency: null,
    estimatedValue: null,
    sourceLanguage: null,
    mediaAssets: [],
    recipient: null,
    recipientUser: null,
    distanceKm: null,
    reopenCount: 0,
    listingId: null,
    listingWorldSlug: null,
    deleteAfter: null,
    createdAt: '2026-05-08T10:00:00.000Z',
    updatedAt: '2026-05-08T10:00:00.000Z',
    ...overrides,
  };
}

export function makeClosureCandidate(overrides: Partial<ClosureCandidate> = {}): ClosureCandidate {
  return {
    userId: 'u_recipient',
    fullName: 'דנה לוי',
    avatarUrl: null,
    cityName: 'תל אביב',
    lastMessageAt: '2026-05-10T10:00:00.000Z',
    ...overrides,
  };
}
