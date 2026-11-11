// Regression guard (audit P1-8, KC#1410): every expo-router route under `app/`
// is covered by the shared route ErrorBoundary — exported by the route file
// itself or by an ancestor `_layout.tsx` — so a render error shows a fallback
// for that segment while the shell, providers and tab bar stay mounted. The
// root layout is the one exception: it owns the top-level class boundary that
// wraps the providers themselves.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

const APP = join(__dirname, '..', '..', '..', 'app');
const EXPORTS_BOUNDARY = /export\s*\{\s*RouteErrorBoundary as ErrorBoundary\s*\}/;
const ROOT_LAYOUT = '_layout.tsx';

// Routes that only the root boundary covers. Each still carries findings under
// the brand guard's touched-file rule (D67), which forbids a one-line edit
// without cleaning the whole file, and none has a layout of its own. Adding
// the export when a file gets its brand cleanup removes it from this list.
const ROOT_BOUNDARY_ONLY = [
  'dev/shell-preview.tsx',
  'edit-post/[id].tsx',
  'edit-profile.tsx',
  'follow/suggestions.tsx',
  'karma-history.tsx',
  'notifications/inbox.tsx',
  'pro.tsx',
  'settings/appearance.tsx',
  'settings/audit.tsx',
  'settings/feed.tsx',
  'settings/feedback.tsx',
  'settings/follow-requests.tsx',
  'settings/language.tsx',
  'settings/report-issue.tsx',
  'settings/survey-demo.tsx',
  'settings/surveys.tsx',
  'stats.tsx',
];

/** Every route module: `.tsx` files under app/, skipping `+html`-style specials and tests. */
function listRouteFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__') listRouteFiles(path, out);
    } else if (name.endsWith('.tsx') && !name.startsWith('+')) {
      out.push(relative(APP, path).split(sep).join('/'));
    }
  }
  return out.sort();
}

const ROUTES = listRouteFiles(APP).filter((route) => route !== ROOT_LAYOUT);
const EXPORTING = new Set(ROUTES.filter((route) => EXPORTS_BOUNDARY.test(readFileSync(join(APP, route), 'utf8'))));

/** Layout files (any platform suffix) between app/ and the route, nearest last. */
function ancestorLayouts(route: string): string[] {
  const dirs = posix.dirname(route).split('/').filter((part) => part !== '.');
  return dirs.map((_, depth) => posix.join(...dirs.slice(0, depth + 1), '_layout')).flatMap((base) =>
    ROUTES.filter((candidate) => candidate === `${base}.tsx` || candidate === `${base}.web.tsx`),
  );
}

function isCovered(route: string): boolean {
  return EXPORTING.has(route) || ancestorLayouts(route).some((layout) => EXPORTING.has(layout));
}

describe('route error boundary inventory', () => {
  it('scans a realistic number of route files', () => {
    // Guards the walker itself: an empty list would make the suite pass vacuously.
    expect(ROUTES.length).toBeGreaterThan(100);
    expect(ROUTES).toContain('(tabs)/_layout.tsx');
    expect(ROUTES).toContain('post/[id].tsx');
  });

  it.each(ROUTES.filter((route) => !ROOT_BOUNDARY_ONLY.includes(route)))(
    '%s is covered by the shared route ErrorBoundary',
    (route) => {
      expect(isCovered(route)).toBe(true);
    },
  );

  it('keeps the root-boundary-only list exact, so a cleaned-up route gets its boundary', () => {
    const uncovered = ROUTES.filter((route) => !isCovered(route));
    expect(uncovered).toEqual(ROOT_BOUNDARY_ONLY);
  });
});
