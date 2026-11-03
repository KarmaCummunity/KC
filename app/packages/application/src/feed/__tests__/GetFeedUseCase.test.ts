import { describe, it, expect } from 'vitest';
import { GetFeedUseCase } from '../GetFeedUseCase';
import { FakePostRepository, makePostWithOwner } from '../../posts/__tests__/fakePostRepository';

describe('GetFeedUseCase', () => {
  it('forwards filter / limit / cursor to the repo (new shape)', async () => {
    const repo = new FakePostRepository();
    repo.posts = [makePostWithOwner({ postId: 'p_1' })];
    const uc = new GetFeedUseCase(repo);

    const out = await uc.execute({
      viewerId: 'viewer_1',
      filter: {
        type: 'Give',
        categories: ['Furniture', 'Toys'],
        itemConditions: ['New', 'LikeNew'],
        locationFilter: { centerCity: 'tel-aviv', centerCityName: 'תל אביב', radiusKm: 25 },
        statusFilter: 'all',
        sortOrder: 'distance',
        proximitySortCity: 'tel-aviv',
      },
      limit: 15,
      cursor: 'cursor_x',
    });

    expect(out.posts).toHaveLength(1);
    expect(out.posts[0]!.postId).toBe('p_1');
    expect(repo.lastGetFeedArgs).toEqual({
      viewerId: 'viewer_1',
      filter: {
        type: 'Give',
        categories: ['Furniture', 'Toys'],
        itemConditions: ['New', 'LikeNew'],
        locationFilter: { centerCity: 'tel-aviv', centerCityName: 'תל אביב', radiusKm: 25 },
        statusFilter: 'all',
        sortOrder: 'distance',
        proximitySortCity: 'tel-aviv',
      },
      limit: 15,
      cursor: 'cursor_x',
    });
  });

  it('drops empty array filters (categories, itemConditions)', async () => {
    const repo = new FakePostRepository();
    const uc = new GetFeedUseCase(repo);

    await uc.execute({
      viewerId: null,
      filter: { categories: [], itemConditions: [], type: 'Give' },
      limit: 20,
    });

    expect(repo.lastGetFeedArgs?.filter.categories).toBeUndefined();
    expect(repo.lastGetFeedArgs?.filter.itemConditions).toBeUndefined();
  });

  it('drops itemConditions when type is not Give', async () => {
    const repo = new FakePostRepository();
    const uc = new GetFeedUseCase(repo);

    await uc.execute({
      viewerId: null,
      filter: { type: 'Request', itemConditions: ['New'] },
      limit: 20,
    });

    expect(repo.lastGetFeedArgs?.filter.itemConditions).toBeUndefined();
  });

  it('drops itemConditions for a Give filter outside the items world', async () => {
    const repo = new FakePostRepository();
    const uc = new GetFeedUseCase(repo);

    await uc.execute({
      viewerId: null,
      filter: { type: 'Give', worlds: ['food'], itemConditions: ['New'] },
      limit: 20,
    });

    expect(repo.lastGetFeedArgs?.filter.itemConditions).toBeUndefined();
  });

  it('keeps world filters and item conditions for Give posts in the items world', async () => {
    const repo = new FakePostRepository();
    const uc = new GetFeedUseCase(repo);

    await uc.execute({
      viewerId: null,
      filter: { type: 'Give', worlds: ['items'], subcategories: ['books'], itemConditions: ['New'] },
      limit: 20,
    });

    expect(repo.lastGetFeedArgs?.filter.worlds).toEqual(['items']);
    expect(repo.lastGetFeedArgs?.filter.subcategories).toEqual(['books']);
    expect(repo.lastGetFeedArgs?.filter.itemConditions).toEqual(['New']);
  });

  it('drops empty worlds and subcategories', async () => {
    const repo = new FakePostRepository();
    const uc = new GetFeedUseCase(repo);

    await uc.execute({
      viewerId: null,
      filter: { type: 'Request', worlds: [], subcategories: [], itemConditions: ['New'] },
      limit: 20,
    });

    expect(repo.lastGetFeedArgs?.filter.itemConditions).toBeUndefined();
    expect(repo.lastGetFeedArgs?.filter.worlds).toBeUndefined();
    expect(repo.lastGetFeedArgs?.filter.subcategories).toBeUndefined();
  });

  it('drops searchQuery shorter than 2 chars and trims longer', async () => {
    const repo = new FakePostRepository();
    const uc = new GetFeedUseCase(repo);

    await uc.execute({ viewerId: null, filter: { searchQuery: ' a ' }, limit: 20 });
    expect(repo.lastGetFeedArgs?.filter.searchQuery).toBeUndefined();

    await uc.execute({ viewerId: null, filter: { searchQuery: '  ספר  ' }, limit: 20 });
    expect(repo.lastGetFeedArgs?.filter.searchQuery).toBe('ספר');
  });

  it('drops blank proximitySortCity (falls back to viewer city in adapter)', async () => {
    const repo = new FakePostRepository();
    const uc = new GetFeedUseCase(repo);

    await uc.execute({
      viewerId: 'viewer_1',
      filter: { sortOrder: 'distance', proximitySortCity: '   ' },
      limit: 20,
    });

    expect(repo.lastGetFeedArgs?.filter.proximitySortCity).toBeUndefined();
    expect(repo.lastGetFeedArgs?.filter.sortOrder).toBe('distance');
  });

  it('drops incoherent locationFilter (missing city or non-positive radius)', async () => {
    const repo = new FakePostRepository();
    const uc = new GetFeedUseCase(repo);

    await uc.execute({
      viewerId: null,
      filter: { locationFilter: { centerCity: '', centerCityName: '', radiusKm: 25 } },
      limit: 20,
    });
    expect(repo.lastGetFeedArgs?.filter.locationFilter).toBeUndefined();

    await uc.execute({
      viewerId: null,
      filter: { locationFilter: { centerCity: 'tel-aviv', centerCityName: 'תל אביב', radiusKm: 0 } },
      limit: 20,
    });
    expect(repo.lastGetFeedArgs?.filter.locationFilter).toBeUndefined();

    await uc.execute({
      viewerId: null,
      filter: { locationFilter: { centerCity: 'tel-aviv', centerCityName: 'תל אביב', radiusKm: -5 } },
      limit: 20,
    });
    expect(repo.lastGetFeedArgs?.filter.locationFilter).toBeUndefined();
  });

  it('clamps limit to [1, 100]', async () => {
    const repo = new FakePostRepository();
    const uc = new GetFeedUseCase(repo);

    await uc.execute({ viewerId: null, filter: {}, limit: 0 });
    expect(repo.lastGetFeedArgs?.limit).toBe(1);

    await uc.execute({ viewerId: null, filter: {}, limit: 999 });
    expect(repo.lastGetFeedArgs?.limit).toBe(100);
  });

  it('defaults limit to 20 when omitted', async () => {
    const repo = new FakePostRepository();
    const uc = new GetFeedUseCase(repo);

    await uc.execute({ viewerId: null, filter: {} });
    expect(repo.lastGetFeedArgs?.limit).toBe(20);
  });
});
