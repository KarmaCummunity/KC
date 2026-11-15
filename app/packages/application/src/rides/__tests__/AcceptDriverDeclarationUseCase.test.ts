// FR-RIDE-041 — AcceptDriverDeclarationUseCase delegates to the repo's accept().
import { describe, expect, it, vi } from 'vitest';
import { AcceptDriverDeclarationUseCase } from '../AcceptDriverDeclarationUseCase';
import type {
  DriverDeclaration,
  IDriverDeclarationRepository,
} from '../../ports/IDriverDeclarationRepository';

const ME = '11111111-1111-4111-8111-111111111111';

function makeDeclaration(): DriverDeclaration {
  return {
    userId: ME,
    declaredAt: '2026-05-31T10:00:00Z',
    version: 1,
  };
}

describe('AcceptDriverDeclarationUseCase', () => {
  it('returns the accepted declaration row', async () => {
    const declaration = makeDeclaration();
    const repo: IDriverDeclarationRepository = {
      getMine: vi.fn(),
      accept: vi.fn().mockResolvedValue(declaration),
    };

    const out = await new AcceptDriverDeclarationUseCase(repo).execute();

    expect(out).toEqual(declaration);
    expect(repo.accept).toHaveBeenCalledTimes(1);
    expect(repo.getMine).not.toHaveBeenCalled();
  });

  it('propagates repository errors', async () => {
    const repo: IDriverDeclarationRepository = {
      getMine: vi.fn(),
      accept: vi.fn().mockRejectedValue(new Error('auth_required')),
    };

    await expect(new AcceptDriverDeclarationUseCase(repo).execute()).rejects.toThrow(
      /auth_required/,
    );
  });
});
