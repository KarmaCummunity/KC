import type { SupabaseClient } from '@supabase/supabase-js';
import {
  KNOWLEDGE_SLOT_SERIES_STATUSES,
  rideWeekdaysFromMask,
  rideWeekdaysToMask,
  type KnowledgeSlotSeries,
  type KnowledgeSlotSeriesInput,
  type KnowledgeSlotSeriesStatus,
} from '@kc/domain';
import type { IKnowledgeSlotSeriesRepository } from '@kc/application';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

type Client = SupabaseClient<Database>;
type SeriesRow = Pick<
  Database['public']['Tables']['knowledge_slot_series']['Row'],
  'post_id' | 'weekdays' | 'start_time' | 'duration_minutes' | 'capacity' | 'ends_on' | 'status'
>;

const SERIES_COLUMNS = 'post_id, weekdays, start_time, duration_minutes, capacity, ends_on, status';

function isSeriesStatus(value: string): value is KnowledgeSlotSeriesStatus {
  return (KNOWLEDGE_SLOT_SERIES_STATUSES as readonly string[]).includes(value);
}

/** A series row as the app sees it; null for a state this build does not know (a newer server). */
export function mapSeriesRow(row: SeriesRow): KnowledgeSlotSeries | null {
  if (!isSeriesStatus(row.status)) return null;
  return {
    postId: row.post_id,
    weekdays: rideWeekdaysFromMask(row.weekdays),
    // Postgres `time` reads as `HH:mm:ss`; the app speaks `HH:mm`.
    startTime: row.start_time.slice(0, 5),
    durationMinutes: row.duration_minutes,
    capacity: row.capacity,
    endsOn: row.ends_on,
    status: row.status,
  };
}

/**
 * Makes a lesson offer recurring (`start_knowledge_slot_series`); the server adds its slots for
 * the next 30 days. Called by the marketplace create path before the offer is published, so a
 * refused schedule leaves no offer behind. Resolves to the series id.
 */
export async function startKnowledgeSlotSeries(client: Client, input: KnowledgeSlotSeriesInput): Promise<string> {
  const result = await client.rpc('start_knowledge_slot_series', {
    p_post_id: input.postId,
    p_weekdays: rideWeekdaysToMask(input.weekdays),
    p_start_time: input.startTime,
    p_duration_minutes: input.durationMinutes,
    p_capacity: input.capacity,
    // An open-ended series sends no last day (the RPC's default).
    ...(input.endsOn ? { p_ends_on: input.endsOn } : {}),
  });
  return unwrapCall('rpc:start_knowledge_slot_series', result) as string;
}

/**
 * The series of recurring lesson offers (FR-KNOW-004 AC1): read from `knowledge_slot_series`
 * (visible exactly when its offer is) and moved with `set_knowledge_slot_series_status`. A
 * refusal is a `BackendRuleError` with the server's reason.
 */
export class SupabaseKnowledgeSlotSeriesRepository implements IKnowledgeSlotSeriesRepository {
  constructor(private readonly client: Client) {}

  async getForPost(postId: string): Promise<KnowledgeSlotSeries | null> {
    const row = unwrapCall(
      'table:knowledge_slot_series',
      await this.client.from('knowledge_slot_series').select(SERIES_COLUMNS).eq('post_id', postId).maybeSingle(),
    );
    return row ? mapSeriesRow(row) : null;
  }

  async setStatus(postId: string, status: KnowledgeSlotSeriesStatus): Promise<void> {
    unwrapCall(
      'rpc:set_knowledge_slot_series_status',
      await this.client.rpc('set_knowledge_slot_series_status', { p_post_id: postId, p_status: status }),
    );
  }
}
