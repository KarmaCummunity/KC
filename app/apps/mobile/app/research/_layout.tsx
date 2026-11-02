// Non-platform fallback for the web-only /research/* shell.
// The real implementation lives in _layout.web.tsx; on native this route
// group is intentionally not exposed. Expo Router requires this fallback
// sibling to exist so route enumeration succeeds on every platform.
// FR-RESEARCH-001 AC1.
export default function ResearchLayoutFallback(): null {
  return null;
}

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';
