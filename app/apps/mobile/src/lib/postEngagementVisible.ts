import type { PostStatus } from '@kc/domain';

/** 07.9 / D25 — likes and comments on posts the viewer can see (open or delivered). */
export function postShowsEngagementSection(status: PostStatus): boolean {
  return status === 'open' || status === 'closed_delivered';
}
