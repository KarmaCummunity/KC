import { describe, it, expect } from 'vitest';
import { UpdateDonationLinkUseCase } from '../UpdateDonationLinkUseCase';
import { DonationLinkError } from '../errors';
import { FakeDonationLinksRepository, makeLink } from './fakeDonationLinksRepository';

describe('UpdateDonationLinkUseCase', () => {
  it('trims inputs and forwards to the repository', async () => {
    const repo = new FakeDonationLinksRepository();
    repo.updateResult = makeLink({ id: 'x', displayName: 'Updated' });
    const uc = new UpdateDonationLinkUseCase(repo);

    const out = await uc.execute({
      linkId: '  abc  ',
      categorySlug: 'food',
      url: '  https://example.org/path  ',
      displayName: '  Updated  ',
      description: '  New desc  ',
    });

    expect(out.displayName).toBe('Updated');
    expect(repo.lastUpdateInput).toEqual({
      linkId: 'abc',
      categorySlug: 'food',
      url: 'https://example.org/path',
      displayName: 'Updated',
      description: 'New desc',
    });
  });

  it('coerces an empty trimmed description to null', async () => {
    const repo = new FakeDonationLinksRepository();
    const uc = new UpdateDonationLinkUseCase(repo);
    await uc.execute({
      linkId: 'id1',
      categorySlug: 'food',
      url: 'https://example.org',
      displayName: 'Example',
      description: '   ',
    });
    expect(repo.lastUpdateInput?.description).toBeNull();
  });

  it('rejects blank linkId', async () => {
    const repo = new FakeDonationLinksRepository();
    const uc = new UpdateDonationLinkUseCase(repo);
    await expect(
      uc.execute({
        linkId: '   ',
        categorySlug: 'food',
        url: 'https://example.org',
        displayName: 'Ex',
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('rejects invalid URLs', async () => {
    const repo = new FakeDonationLinksRepository();
    const uc = new UpdateDonationLinkUseCase(repo);
    await expect(
      uc.execute({
        linkId: 'id1',
        categorySlug: 'food',
        url: 'ftp://x',
        displayName: 'Ex',
      }),
    ).rejects.toMatchObject({ code: 'invalid_url' });
  });

  it('rejects display name that is too short or too long', async () => {
    const repo = new FakeDonationLinksRepository();
    const uc = new UpdateDonationLinkUseCase(repo);

    await expect(
      uc.execute({
        linkId: 'id1',
        categorySlug: 'food',
        url: 'https://example.org',
        displayName: ' ',
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });

    await expect(
      uc.execute({
        linkId: 'id1',
        categorySlug: 'food',
        url: 'https://example.org',
        displayName: 'a'.repeat(101),
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('rejects description exceeding maximum allowed length', async () => {
    const repo = new FakeDonationLinksRepository();
    const uc = new UpdateDonationLinkUseCase(repo);

    await expect(
      uc.execute({
        linkId: 'id1',
        categorySlug: 'food',
        url: 'https://example.org',
        displayName: 'Example',
        description: 'a'.repeat(301),
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('propagates repository errors', async () => {
    const repo = new FakeDonationLinksRepository();
    repo.updateError = new DonationLinkError('forbidden', 'not owner');
    const uc = new UpdateDonationLinkUseCase(repo);
    await expect(
      uc.execute({
        linkId: 'id1',
        categorySlug: 'food',
        url: 'https://example.org',
        displayName: 'Example',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
