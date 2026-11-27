// Resolves a knowledge listing's subcategory id to its D100 shelf slug.
import { useQuery } from '@tanstack/react-query';
import { knowledgeShelfSlugOf, type KnowledgeShelfSlug } from '@kc/domain';
import { marketplaceRepository } from '../services/marketplaceComposition';

/** Shelf slug of a knowledge listing from its world subcategory id; null when unknown. */
export function useKnowledgeShelfSlug(
  worldSlug: string,
  worldSubcategoryId: string | null | undefined,
): KnowledgeShelfSlug | null {
  const query = useQuery({
    queryKey: ['world-subcategories', worldSlug],
    queryFn: () => marketplaceRepository().listWorldSubcategories(worldSlug),
    enabled: worldSlug === 'knowledge' && Boolean(worldSubcategoryId),
    staleTime: 10 * 60_000,
  });
  if (worldSlug !== 'knowledge' || !worldSubcategoryId || !query.data) return null;
  const match = query.data.find((row) => row.categoryId === worldSubcategoryId);
  return knowledgeShelfSlugOf(match?.slug);
}
