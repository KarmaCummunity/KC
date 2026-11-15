// Composition root for recurring time posts (`docs/spec/requirements/04_posts.md` FR-POST-024).
import {
  CancelPostSeriesOccurrenceUseCase,
  CreatePostSeriesUseCase,
  ListMyPostSeriesUseCase,
  ListPostSeriesOccurrencesUseCase,
  SetPostSeriesStatusUseCase,
  UpdatePostSeriesUseCase,
  type IPostSeriesRepository,
} from '@kc/application';
import { SupabasePostSeriesRepository } from '@kc/infrastructure-supabase';
import { getMarketplaceSupabaseClient } from './marketplaceComposition';

let repo: IPostSeriesRepository | null = null;

function repository(): IPostSeriesRepository {
  repo ??= new SupabasePostSeriesRepository(getMarketplaceSupabaseClient());
  return repo;
}

export const postSeriesUseCases = {
  create: () => new CreatePostSeriesUseCase(repository()),
  listMine: () => new ListMyPostSeriesUseCase(repository()),
  update: () => new UpdatePostSeriesUseCase(repository()),
  setStatus: () => new SetPostSeriesStatusUseCase(repository()),
  cancelOccurrence: () => new CancelPostSeriesOccurrenceUseCase(repository()),
  listOccurrences: () => new ListPostSeriesOccurrencesUseCase(repository()),
};

export const MY_POST_SERIES_QUERY_KEY = ['post-series'] as const;

/** The upcoming dates of one series ("other dates" on a date's post, and the owner's list). */
export const postSeriesOccurrencesQueryKey = (seriesId: string) => ['post-series-occurrences', seriesId] as const;
