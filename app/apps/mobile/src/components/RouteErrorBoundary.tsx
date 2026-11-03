// Route-segment error boundary (audit P1-8). expo-router renders a route's
// exported `ErrorBoundary` in place of that segment when it throws, so the app
// shell, providers and tab bar stay mounted and only the broken screen shows
// the fallback. Usage in a route file:
//   export { RouteErrorBoundary as ErrorBoundary } from '<path>/RouteErrorBoundary';
import React, { useEffect } from 'react';
import { usePathname, type ErrorBoundaryProps } from 'expo-router';
import { ErrorBoundaryFallback, reportRenderError } from './ErrorBoundary';

export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const route = usePathname();
  useEffect(() => {
    reportRenderError(error, { tags: { boundary: 'route', route } });
  }, [error, route]);
  return <ErrorBoundaryFallback error={error} onRetry={() => void retry()} />;
}
