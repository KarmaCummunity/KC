import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BackendRuleError,
  POST_SERIES_STATUSES,
  rideWeekdaysFromMask,
  rideWeekdaysToMask,
  type CreatePostSeriesInput,
  type CreatedPostSeries,
  type PostSeries,
  type PostSeriesOccurrence,
  type PostSeriesStatus,
  type UpdatePostSeriesInput,
} from '@kc/domain';
import type { IPostSeriesRepository } from '@kc/application';
import type { Database, Json } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { requireRpcRow } from '../marketplace/rpcRow';
import { loadKindCatalog } from '../marketplace/kindCatalog';
import { eventDetailColumns, freeDetails } from '../marketplace/worldDetails';

type Client = SupabaseClient<Database>;
type SeriesRow = Database['public']['Tables']['post_series']['Row'];

const isObject = (value: Json): value is { [key: string]: Json | undefined } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Recurring events over `post_series` (readable by its owner alone) and its RPCs, which own the
 * dates: `create_post_series`, `update_post_series`, `set_post_series_status`,
 * `cancel_post_series_date`. Dates are ordinary event posts, so their list is a read of
 * `post_event_details` by `series_id` (FR-POST-024).
 */
export class SupabasePostSeriesRepository implements IPostSeriesRepository {
  constructor(private readonly client: Client) {}

  async listMine(): Promise<PostSeries[]> {
    const rows =
      unwrapCall(
        'table:post_series',
        await this.client.from('post_series').select('*').neq('status', 'ended').order('created_at', { ascending: true }),
      ) ?? [];
    return rows.flatMap((row) => {
      const series = mapPostSeriesRow(row);
      return series ? [series] : [];
    });
  }

  /** Publishes the series and its first dates; resolves to the series and its soonest date's post. */
  async create(input: CreatePostSeriesInput): Promise<CreatedPostSeries> {
    const kind = (await loadKindCatalog(this.client)).byId.get(input.kindId);
    if (!kind) throw new BackendRuleError('post_kind_not_allowed', 'rpc:create_post_series');
    // The template has no times of its own: every date takes them from the schedule.
    const { starts_at: _starts, ends_at: _ends, ...event } = eventDetailColumns(input.details);
    const seriesId = requireRpcRow(unwrapCall(
      'rpc:create_post_series',
      await this.client.rpc('create_post_series', {
        p_post: {
          world_slug: kind.world_slug, kind_id: input.kindId, direction: 'offer', title: input.title,
          description: input.summary, city_id: input.cityId, details: freeDetails(input.details, 'event'),
        },
        p_event: event as Json,
        p_start_time: input.schedule.startTime,
        p_weekdays: rideWeekdaysToMask(input.schedule.weekdays),
        p_duration_minutes: input.schedule.durationMinutes,
        p_ends_on: input.schedule.endsOn ?? undefined,
        p_time_zone: input.timeZone,
        p_org_id: input.orgId ?? undefined,
      }),
    ), 'create_post_series');
    const first = (await this.listOccurrences(seriesId))[0];
    return { seriesId, firstPostId: requireRpcRow(first, 'create_post_series').postId };
  }

  async update(seriesId: string, input: UpdatePostSeriesInput): Promise<void> {
    unwrapCall(
      'rpc:update_post_series',
      await this.client.rpc('update_post_series', {
        p_series_id: seriesId,
        p_start_time: input.schedule.startTime,
        p_weekdays: rideWeekdaysToMask(input.schedule.weekdays),
        p_duration_minutes: input.schedule.durationMinutes,
        p_ends_on: input.schedule.endsOn ?? undefined,
      }),
    );
  }

  async setStatus(seriesId: string, status: PostSeriesStatus): Promise<void> {
    unwrapCall('rpc:set_post_series_status', await this.client.rpc('set_post_series_status', { p_series_id: seriesId, p_status: status }));
  }

  async cancelOccurrence(postId: string): Promise<void> {
    unwrapCall('rpc:cancel_post_series_date', await this.client.rpc('cancel_post_series_date', { p_post_id: postId }));
  }

  /** The upcoming open dates of a series the caller may see, soonest first. */
  async listOccurrences(seriesId: string): Promise<PostSeriesOccurrence[]> {
    const rows =
      unwrapCall(
        'table:post_event_details',
        await this.client
          .from('post_event_details')
          .select('post_id, starts_at, series_on, posts(status)')
          .eq('series_id', seriesId)
          .gt('starts_at', new Date().toISOString())
          .order('starts_at', { ascending: true }),
      ) ?? [];
    return rows.flatMap((row) => {
      const post = Array.isArray(row.posts) ? row.posts[0] : row.posts;
      if (!post || post.status !== 'open' || !row.series_on) return [];
      return [{ postId: row.post_id, occurrenceOn: row.series_on, startsAt: row.starts_at }];
    });
  }
}

function isStatus(value: string): value is PostSeriesStatus {
  return (POST_SERIES_STATUSES as readonly string[]).includes(value);
}

/** Maps one row; a row of an unknown status is dropped. `start_time` arrives as `HH:MM:SS`. */
export function mapPostSeriesRow(row: SeriesRow): PostSeries | null {
  if (!isStatus(row.status)) return null;
  const post = isObject(row.post_template) ? row.post_template : {};
  const event = isObject(row.event_template) ? row.event_template : {};
  return {
    id: row.id,
    title: typeof post['title'] === 'string' ? post['title'] : '',
    capacity: typeof event['capacity'] === 'number' ? event['capacity'] : null,
    schedule: {
      weekdays: rideWeekdaysFromMask(row.weekdays),
      startTime: row.start_time.slice(0, 5),
      durationMinutes: row.duration_minutes,
      endsOn: row.ends_on,
    },
    timeZone: row.time_zone,
    status: row.status,
  };
}
