// Non-platform fallback for /research/thanks. The real page lives in
// thanks.web.tsx — see FR-RESEARCH-001 AC5. This stub satisfies Expo
// Router's "every .web.tsx route needs a fallback sibling" rule so route
// enumeration succeeds on native bundles too.
export default function ResearchThanksFallback(): null {
  return null;
}

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';
