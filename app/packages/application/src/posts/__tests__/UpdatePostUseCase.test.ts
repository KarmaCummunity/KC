import { describe, it, expect } from 'vitest';
import { UpdatePostUseCase } from '../UpdatePostUseCase';
import { FakePostRepository, makePostWithOwner } from './fakePostRepository';

describe('UpdatePostUseCase', () => {
  it('forwards a non-visibility patch and returns the new row', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner({ postId: 'p_1', visibility: 'Public' });
    repo.updateResult = { ...makePostWithOwner({ postId: 'p_1', title: 'חדש' }) };
    const uc = new UpdatePostUseCase(repo);

    const out = await uc.execute({
      postId: 'p_1',
      viewerId: 'u_1',
      patch: { title: '  חדש  ' },
    });

    expect(out.post.title).toBe('חדש');
    expect(repo.lastUpdateArgs?.patch.title).toBe('חדש');
  });

  it('allows visibility change (Public → OnlyMe)', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner({ visibility: 'Public' });
    repo.updateResult = makePostWithOwner({ visibility: 'OnlyMe' });
    const uc = new UpdatePostUseCase(repo);

    await uc.execute({ postId: 'p_1', viewerId: 'u_1', patch: { visibility: 'OnlyMe' } });
    expect(repo.lastUpdateArgs?.patch.visibility).toBe('OnlyMe');
  });

  it('allows visibility upgrade (OnlyMe → Public)', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner({ visibility: 'OnlyMe' });
    repo.updateResult = makePostWithOwner({ visibility: 'Public' });
    const uc = new UpdatePostUseCase(repo);

    await uc.execute({ postId: 'p_1', viewerId: 'u_1', patch: { visibility: 'Public' } });
    expect(repo.lastUpdateArgs?.patch.visibility).toBe('Public');
  });

  it('allows visibility upgrade (OnlyMe → FollowersOnly)', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner({ visibility: 'OnlyMe' });
    repo.updateResult = makePostWithOwner({ visibility: 'FollowersOnly' });
    const uc = new UpdatePostUseCase(repo);

    await uc.execute({ postId: 'p_1', viewerId: 'u_1', patch: { visibility: 'FollowersOnly' } });
    expect(repo.lastUpdateArgs?.patch.visibility).toBe('FollowersOnly');
  });

  it('allows visibility upgrade (FollowersOnly → Public)', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner({ visibility: 'FollowersOnly' });
    repo.updateResult = makePostWithOwner({ visibility: 'Public' });
    const uc = new UpdatePostUseCase(repo);

    await uc.execute({ postId: 'p_1', viewerId: 'u_1', patch: { visibility: 'Public' } });
    expect(repo.lastUpdateArgs?.patch.visibility).toBe('Public');
  });

  it('allows visibility change (FollowersOnly → OnlyMe)', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner({ visibility: 'FollowersOnly' });
    repo.updateResult = makePostWithOwner({ visibility: 'OnlyMe' });
    const uc = new UpdatePostUseCase(repo);

    await uc.execute({ postId: 'p_1', viewerId: 'u_1', patch: { visibility: 'OnlyMe' } });
    expect(repo.lastUpdateArgs?.patch.visibility).toBe('OnlyMe');
  });

  it('allows visibility change (Public → FollowersOnly)', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner({ visibility: 'Public' });
    repo.updateResult = makePostWithOwner({ visibility: 'FollowersOnly' });
    const uc = new UpdatePostUseCase(repo);

    await uc.execute({ postId: 'p_1', viewerId: 'u_1', patch: { visibility: 'FollowersOnly' } });
    expect(repo.lastUpdateArgs?.patch.visibility).toBe('FollowersOnly');
  });

  it('treats same-value visibility patch as a no-op (Public → Public)', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner({ visibility: 'Public' });
    repo.updateResult = makePostWithOwner({ visibility: 'Public' });
    const uc = new UpdatePostUseCase(repo);

    await uc.execute({ postId: 'p_1', viewerId: 'u_1', patch: { visibility: 'Public' } });
    expect(repo.lastUpdateArgs?.patch.visibility).toBe('Public');
  });

  it('rejects title > 80 chars in patch', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner();
    const uc = new UpdatePostUseCase(repo);
    await expect(
      uc.execute({ postId: 'p_1', viewerId: 'u_1', patch: { title: 'a'.repeat(81) } }),
    ).rejects.toMatchObject({ code: 'title_too_long' });
  });

  it('throws a typed PostError(not_found) when the post is missing (so the UI maps it instead of showing a network error)', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = null;
    const uc = new UpdatePostUseCase(repo);
    await expect(
      uc.execute({ postId: 'missing', viewerId: 'u_1', patch: { title: 'x' } }),
    ).rejects.toMatchObject({ name: 'PostError', code: 'not_found' });
  });

  it('edits a paused post as it edits an open one (spec 07 §7.1)', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner({ status: 'paused' });
    repo.updateResult = makePostWithOwner({ status: 'paused', title: 'שינוי' });
    const uc = new UpdatePostUseCase(repo);
    await expect(
      uc.execute({ postId: 'p_1', viewerId: 'u_1', patch: { title: 'שינוי' } }),
    ).resolves.toBeDefined();
    expect(repo.lastUpdateArgs).not.toBeNull();
  });

  it('rejects editing a non-open post (expired)', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner({ status: 'expired' });
    const uc = new UpdatePostUseCase(repo);
    await expect(
      uc.execute({ postId: 'p_1', viewerId: 'u_1', patch: { title: 'שינוי' } }),
    ).rejects.toMatchObject({ code: 'post_not_open' });
    expect(repo.lastUpdateArgs).toBeNull();
  });

  it('rejects editing a non-open post (removed_admin)', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner({ status: 'removed_admin' });
    const uc = new UpdatePostUseCase(repo);
    await expect(
      uc.execute({ postId: 'p_1', viewerId: 'u_1', patch: { title: 'שינוי' } }),
    ).rejects.toMatchObject({ code: 'post_not_open' });
    expect(repo.lastUpdateArgs).toBeNull();
  });

  it('allows visibility-only patch on closed_delivered (FR-POST-009 + D-34)', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner({ status: 'closed_delivered', visibility: 'Public' });
    repo.updateResult = makePostWithOwner({ status: 'closed_delivered', visibility: 'OnlyMe' });
    const uc = new UpdatePostUseCase(repo);

    await uc.execute({ postId: 'p_1', viewerId: 'u_1', patch: { visibility: 'OnlyMe' } });
    expect(repo.lastUpdateArgs?.patch.visibility).toBe('OnlyMe');
  });

  it('allows visibility-only patch on deleted_no_recipient (grace window)', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner({ status: 'deleted_no_recipient', visibility: 'Public' });
    repo.updateResult = makePostWithOwner({ status: 'deleted_no_recipient', visibility: 'OnlyMe' });
    const uc = new UpdatePostUseCase(repo);

    await uc.execute({ postId: 'p_1', viewerId: 'u_1', patch: { visibility: 'OnlyMe' } });
    expect(repo.lastUpdateArgs?.patch.visibility).toBe('OnlyMe');
  });

  it('rejects non-visibility patch on closed_delivered (title)', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner({ status: 'closed_delivered' });
    const uc = new UpdatePostUseCase(repo);
    await expect(
      uc.execute({ postId: 'p_1', viewerId: 'u_1', patch: { title: 'שינוי' } }),
    ).rejects.toMatchObject({ code: 'post_not_open' });
    expect(repo.lastUpdateArgs).toBeNull();
  });

  it('rejects visibility patch on removed_admin', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner({ status: 'removed_admin', visibility: 'Public' });
    const uc = new UpdatePostUseCase(repo);
    await expect(
      uc.execute({ postId: 'p_1', viewerId: 'u_1', patch: { visibility: 'OnlyMe' } }),
    ).rejects.toMatchObject({ code: 'post_not_open' });
    expect(repo.lastUpdateArgs).toBeNull();
  });

  it('rejects visibility patch on expired', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner({ status: 'expired', visibility: 'Public' });
    const uc = new UpdatePostUseCase(repo);
    await expect(
      uc.execute({ postId: 'p_1', viewerId: 'u_1', patch: { visibility: 'OnlyMe' } }),
    ).rejects.toMatchObject({ code: 'post_not_open' });
    expect(repo.lastUpdateArgs).toBeNull();
  });

  it('rejects clearing all images on a Give post (FR-POST-008 AC1)', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner({ type: 'Give' });
    const uc = new UpdatePostUseCase(repo);
    await expect(
      uc.execute({ postId: 'p_1', viewerId: 'u_1', patch: { mediaAssets: [] } }),
    ).rejects.toMatchObject({ code: 'image_required_for_give' });
    expect(repo.lastUpdateArgs).toBeNull();
  });

  it('allows replacing images on a Give post when at least one remains', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner({ type: 'Give' });
    repo.updateResult = makePostWithOwner({ type: 'Give' });
    const uc = new UpdatePostUseCase(repo);
    const mediaAssets = [{ path: 'u/b/0.jpg', mimeType: 'image/jpeg', sizeBytes: 100 }];
    await uc.execute({ postId: 'p_1', viewerId: 'u_1', patch: { mediaAssets } });
    expect(repo.lastUpdateArgs?.patch.mediaAssets).toEqual(mediaAssets);
  });

  it('allows clearing all images on a Request post', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner({ type: 'Request' });
    repo.updateResult = makePostWithOwner({ type: 'Request', mediaAssets: [] });
    const uc = new UpdatePostUseCase(repo);
    await uc.execute({ postId: 'p_1', viewerId: 'u_1', patch: { mediaAssets: [] } });
    expect(repo.lastUpdateArgs?.patch.mediaAssets).toEqual([]);
  });
});
