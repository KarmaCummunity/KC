import { describe, it, expect } from 'vitest';
import { DESCRIPTION_MAX_CHARS, MAX_MEDIA_ASSETS } from '@kc/domain';
import { UpdatePostUseCase } from '../UpdatePostUseCase';
import { FakePostRepository, makePostWithOwner } from './fakePostRepository';

describe('UpdatePostUseCase input validation and permissions', () => {
  it('throws forbidden when viewerId does not match post owner', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner({ postId: 'p_1', ownerId: 'u_real_owner' });
    const uc = new UpdatePostUseCase(repo);

    await expect(
      uc.execute({ postId: 'p_1', viewerId: 'u_impostor', patch: { title: 'New' } }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('rejects empty or whitespace-only title in patch', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner();
    const uc = new UpdatePostUseCase(repo);

    await expect(
      uc.execute({ postId: 'p_1', viewerId: 'u_1', patch: { title: '    ' } }),
    ).rejects.toMatchObject({ code: 'title_required' });
  });

  it('rejects description longer than DESCRIPTION_MAX_CHARS', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner();
    const uc = new UpdatePostUseCase(repo);

    await expect(
      uc.execute({
        postId: 'p_1',
        viewerId: 'u_1',
        patch: { description: 'a'.repeat(DESCRIPTION_MAX_CHARS + 1) },
      }),
    ).rejects.toMatchObject({ code: 'description_too_long' });
  });

  it('normalizes description trimming and allows null description', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner();
    repo.updateResult = makePostWithOwner();
    const uc = new UpdatePostUseCase(repo);

    await uc.execute({
      postId: 'p_1',
      viewerId: 'u_1',
      patch: { description: '  trimmed description  ' },
    });
    expect(repo.lastUpdateArgs?.patch.description).toBe('trimmed description');

    await uc.execute({
      postId: 'p_1',
      viewerId: 'u_1',
      patch: { description: null },
    });
    expect(repo.lastUpdateArgs?.patch.description).toBeNull();
  });

  it('normalizes urgency and trims or clears to null', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner();
    repo.updateResult = makePostWithOwner();
    const uc = new UpdatePostUseCase(repo);

    await uc.execute({
      postId: 'p_1',
      viewerId: 'u_1',
      patch: { urgency: '  Urgent  ' as never },
    });
    expect(repo.lastUpdateArgs?.patch.urgency).toBe('Urgent');

    await uc.execute({
      postId: 'p_1',
      viewerId: 'u_1',
      patch: { urgency: '   ' as never },
    });
    expect(repo.lastUpdateArgs?.patch.urgency).toBeNull();
  });

  it('validates address requiring city, street, and streetNumber', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner();
    const uc = new UpdatePostUseCase(repo);

    await expect(
      uc.execute({
        postId: 'p_1',
        viewerId: 'u_1',
        // @ts-expect-error missing street and streetNumber
        patch: { address: { city: 'City' } },
      }),
    ).rejects.toMatchObject({ code: 'address_required' });

    repo.updateResult = makePostWithOwner();
    await uc.execute({
      postId: 'p_1',
      viewerId: 'u_1',
      patch: { address: { city: 'City', cityName: 'CityName', street: 'Street', streetNumber: '12' } },
    });
    expect(repo.lastUpdateArgs?.patch.address).toEqual({
      city: 'City',
      cityName: 'CityName',
      street: 'Street',
      streetNumber: '12',
    });
  });

  it('rejects mediaAssets exceeding MAX_MEDIA_ASSETS', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner();
    const uc = new UpdatePostUseCase(repo);

    const excessiveMedia = Array.from({ length: MAX_MEDIA_ASSETS + 1 }, (_, i) => ({
      path: `u/b/${i}.jpg`,
      mimeType: 'image/jpeg',
      sizeBytes: 100,
    }));

    await expect(
      uc.execute({
        postId: 'p_1',
        viewerId: 'u_1',
        patch: { mediaAssets: excessiveMedia },
      }),
    ).rejects.toMatchObject({ code: 'too_many_media_assets' });
  });
});
