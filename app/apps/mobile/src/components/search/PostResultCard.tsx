// FR-FEED-017 — post result card for universal search. Thin wrapper over the shared
// base post card (PostCardGrid → KcCard) so search renders posts like every other surface.
import type { PostWithOwner } from '@kc/application';
import { PostCardGrid } from '../PostCardGrid';

export function PostResultCard({ post }: { readonly post: PostWithOwner }) {
  return <PostCardGrid post={post} />;
}
