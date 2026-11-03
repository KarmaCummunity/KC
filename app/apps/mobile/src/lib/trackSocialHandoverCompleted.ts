import type { Post } from '@kc/domain';
import { trackCoreLoop } from './analyticsCoreLoop';

/** FR-CLOSURE / core loop (#1043) — social post marked delivered from chat or post detail. */
export function trackSocialHandoverCompleted(post: Post): void {
  trackCoreLoop('handover_completed', {
    world: 'social',
    cityId: post.address.city,
    postId: post.postId,
  });
}
