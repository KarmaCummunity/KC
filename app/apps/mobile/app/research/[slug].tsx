// Non-platform fallback for /research/[slug]. The real runner lives in
// [slug].web.tsx — Survey B (the public market research form) is web-only
// by design (FR-RESEARCH-001 AC1). This stub exists solely to satisfy
// Expo Router's "every .web.tsx route needs a fallback sibling" rule.
export default function ResearchSlugFallback(): null {
  return null;
}

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';
