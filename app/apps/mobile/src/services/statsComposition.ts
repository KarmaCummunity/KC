// Statistics by audience (FR-STATS-007 / 008): lazy singletons over the shared stats adapter.
// Kept beside postsComposition (which owns the adapter) so that file stays focused on posts.
import { GetWorldFlowFunnelUseCase, ListMyWorldGivingsUseCase } from '@kc/application';
import { getStatsRepo } from './postsComposition';

let _worldFlowFunnel: GetWorldFlowFunnelUseCase | undefined;
let _myWorldGivings: ListMyWorldGivingsUseCase | undefined;

/** FR-STATS-007 — the platform flow funnel (admins). */
export function getWorldFlowFunnelUseCase(): GetWorldFlowFunnelUseCase {
  _worldFlowFunnel ??= new GetWorldFlowFunnelUseCase(getStatsRepo());
  return _worldFlowFunnel;
}

/** FR-STATS-008 — the signed-in member's own givings per world. */
export function getListMyWorldGivingsUseCase(): ListMyWorldGivingsUseCase {
  _myWorldGivings ??= new ListMyWorldGivingsUseCase(getStatsRepo());
  return _myWorldGivings;
}
