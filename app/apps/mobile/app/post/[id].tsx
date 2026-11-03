// Post detail route — lazy-loads heavy screen for faster cold start.
import React, { Suspense, lazy } from 'react';
import { PostGridSkeleton } from '../../src/components/skeletons/PostGridSkeleton';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

const PostDetailScreen = lazy(() => import('../../src/screens/post/PostDetailScreen'));

export default function PostDetailRoute() {
  return (
    <Suspense fallback={<PostGridSkeleton columns={1} count={3} />}>
      <PostDetailScreen />
    </Suspense>
  );
}
