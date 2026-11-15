import { describe, expect, it } from 'vitest';
import { emptyWorldContent } from '@kc/domain';
import { GetWorldContentUseCase } from '../GetWorldContentUseCase';

describe('GetWorldContentUseCase', () => {
  it('reads the content of the asked world from the repository', async () => {
    const asked: string[] = [];
    const useCase = new GetWorldContentUseCase({
      getWorldContent: async (worldSlug) => {
        asked.push(worldSlug);
        return emptyWorldContent(worldSlug);
      },
    });
    await expect(useCase.execute('medical')).resolves.toEqual(emptyWorldContent('medical'));
    expect(asked).toEqual(['medical']);
  });
});
