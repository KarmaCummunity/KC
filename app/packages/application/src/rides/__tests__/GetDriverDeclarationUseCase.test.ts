// FR-RIDE-041 — GetDriverDeclarationUseCase reads the caller's declaration.
import { describe, expect, it, vi } from 'vitest';
import { GetDriverDeclarationUseCase } from '../GetDriverDeclarationUseCase';
import type {
  DriverDeclaration,
  IDriverDeclarationRepository,
} from '../../ports/IDriverDeclarationRepository';

const ME = '11111111-1111-4111-8111-111111111111';

describe('GetDriverDeclarationUseCase', () => {
  it('returns the declaration row when present', async () => {
    const declaration: DriverDeclaration = {
      userId: ME,
      declaredAt: '2026-05-31T10:00:00Z',
      version: 1,
    };
    const repo: IDriverDeclarationRepository = {
      getMine: vi.fn().mockResolvedValue(declaration),
      accept: vi.fn(),
    };

    const out = await new GetDriverDeclarationUseCase(repo).execute();

    expect(out).toEqual(declaration);
    expect(repo.getMine).toHaveBeenCalledTimes(1);
    expect(repo.accept).not.toHaveBeenCalled();
  });

  it('returns null when the caller has not accepted yet', async () => {
    const repo: IDriverDeclarationRepository = {
      getMine: vi.fn().mockResolvedValue(null),
      accept: vi.fn(),
    };

    const out = await new GetDriverDeclarationUseCase(repo).execute();

    expect(out).toBeNull();
  });
});
