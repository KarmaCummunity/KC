// FR-RIDE-037..038 — adapter for IRideRatingRepository.
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IRideRatingRepository,
  SubmitRideRatingInput,
} from '@kc/application';
import type { RideRating, UserRideRatingSummary } from '@kc/domain';
import { RideError } from '@kc/domain';
import type { Database } from '../database.legacy.types';

type Row = Database['public']['Tables']['ride_ratings']['Row'];
type SummaryRow = Database['public']['Views']['user_ride_rating_summary']['Row'];

function map(row: Row): RideRating {
  const stars = row.stars as 1 | 2 | 3 | 4 | 5;
  return {
    ratingId: row.rating_id,
    rideId: row.ride_id,
    raterId: row.rater_id,
    rateeId: row.ratee_id,
    stars,
    comment: row.comment,
    isPenalty: row.is_penalty,
    createdAt: row.created_at,
  };
}

export class SupabaseRideRatingRepository implements IRideRatingRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async submit(input: SubmitRideRatingInput): Promise<RideRating> {
    const { data, error } = await this.client.rpc('rpc_ride_rate', {
      p_ride_id: input.rideId,
      p_ratee_id: input.rateeId,
      p_stars: input.stars,
      p_comment: input.comment ?? undefined,
      p_is_penalty: input.isPenalty ?? false,
    });
    if (error) {
      const code = (error.message ?? '').trim();
      switch (code) {
        case 'auth_required':
        case 'ride_not_found':
        case 'rating_window_closed':
        case 'rating_duplicate':
        case 'rating_not_participant':
          throw new RideError(code as never, code);
        default:
          throw new Error(error.message);
      }
    }
    if (!data) throw new Error('submit_rating: empty response');
    return map(data as Row);
  }

  async listForRide(rideId: string): Promise<readonly RideRating[]> {
    const { data, error } = await this.client
      .from('ride_ratings')
      .select('*')
      .eq('ride_id', rideId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map(map);
  }

  async summaryFor(userId: string): Promise<UserRideRatingSummary | null> {
    const { data, error } = await this.client
      .from('user_ride_rating_summary')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const row = data as SummaryRow;
    if (!row.user_id) return null;
    return {
      userId: row.user_id,
      ratingsCount: row.ratings_count ?? 0,
      avgStars: row.avg_stars ?? 0,
      lastRatedAt: row.last_rated_at,
    };
  }
}
