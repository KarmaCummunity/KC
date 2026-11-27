import { describe, expect, it } from 'vitest';
import { emptyWorldContent, type KnowledgeShelfLink } from '@kc/domain';
import { ListKnowledgeShelfLinksUseCase } from '../ListKnowledgeShelfLinksUseCase';

const LINK: KnowledgeShelfLink = {
  linkId: 'l1',
  shelfSlug: 'rights_legal_aid',
  linkSlug: 'kol_zchut',
  labelHe: 'כל זכות',
  labelEn: 'Kol Zchut',
  url: 'https://www.kolzchut.org.il/',
};

describe('ListKnowledgeShelfLinksUseCase', () => {
  it('reads the links of the asked shelf from the repository', async () => {
    const asked: string[] = [];
    const useCase = new ListKnowledgeShelfLinksUseCase({
      getWorldContent: async (worldSlug) => emptyWorldContent(worldSlug),
      listKnowledgeShelfLinks: async (shelfSlug) => {
        asked.push(shelfSlug);
        return [LINK];
      },
    });
    await expect(useCase.execute('rights_legal_aid')).resolves.toEqual([LINK]);
    expect(asked).toEqual(['rights_legal_aid']);
  });
});
