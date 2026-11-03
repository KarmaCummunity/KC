// Statistics by audience (FR-STATS-007 / 008): the platform funnel for the team and a member's
// own givings per world. Authorization is server-side (admin_world_flow_funnel checks the
// reviewer roles, my_world_givings reads only the caller); these use cases shape input only.
import type { IStatsRepository, MyWorldGivings, WorldFlowFunnelRow } from '../ports/IStatsRepository';

/** The funnel windows the server accepts (it clamps to the same range). */
export const FUNNEL_WINDOW_MIN_DAYS = 1;
export const FUNNEL_WINDOW_MAX_DAYS = 365;

export class GetWorldFlowFunnelUseCase {
  constructor(private readonly repo: IStatsRepository) {}

  /** The funnel over the last `days`, clamped to 1..365 and rounded to whole days. */
  execute(days: number): Promise<WorldFlowFunnelRow[]> {
    const whole = Number.isFinite(days) ? Math.round(days) : 30;
    const clamped = Math.min(Math.max(whole, FUNNEL_WINDOW_MIN_DAYS), FUNNEL_WINDOW_MAX_DAYS);
    return this.repo.getWorldFlowFunnel(clamped);
  }
}

export class ListMyWorldGivingsUseCase {
  constructor(private readonly repo: IStatsRepository) {}

  execute(): Promise<MyWorldGivings[]> {
    return this.repo.listMyWorldGivings();
  }
}
