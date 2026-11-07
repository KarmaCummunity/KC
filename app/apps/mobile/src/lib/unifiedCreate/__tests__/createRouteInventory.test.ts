// Regression guard: there must be exactly ONE create form for requests/offers.
// Fails if a per-domain create screen/route or a separate create form is reintroduced.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const MOBILE = join(__dirname, '../../../..');
const APP = join(MOBILE, 'app');
const SRC = join(MOBILE, 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === 'node_modules' || n === '__tests__') return [];
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// The organizer's volunteer-opportunity screen was retired in G1 step 5: an organization's event
// and a volunteer shift are both published from the one create form.
// The form is a root-stack screen so it opens over the current screen (FR-POST-001 AC9).
const ALLOWED_CREATE_ROUTES = ['create.tsx'];
// Not member request/offer forms: admin back-office and the chat recipient picker.
const NON_FORM_ROUTES = /^\(admin\)\/|^chat\/new\.tsx$/;

describe('unified create — route inventory', () => {
  const routes = walk(APP).map((p) => relative(APP, p).split('\\').join('/'));
  const files = [...walk(APP), ...walk(SRC)].filter((p) => /\.(ts|tsx)$/.test(p));

  // Admin back-office routes ((admin)/…) are not member request/offer forms.
  it('no per-domain create route exists', () => {
    const createRoutes = routes.filter((r) => !NON_FORM_ROUTES.test(r) && /(^|\/)(create|new)(\/|\.tsx$|-)/i.test(r));
    expect(createRoutes.sort()).toEqual([...ALLOWED_CREATE_ROUTES].sort());
  });

  it('nothing navigates to a legacy per-domain create path', () => {
    const offenders = files.filter((p) => /marketplace\/create|createPath=/.test(readFileSync(p, 'utf8')));
    expect(offenders.map((p) => relative(MOBILE, p))).toEqual([]);
  });

  it('listing/post create forms are only mounted by the unified screen', () => {
    const mounts = files.filter((p) => /<(ListingCreateForm|MarketplaceCreateForm|CreatePostFormScrollContent|RideCreateSheet)\b/.test(readFileSync(p, 'utf8')));
    // `WorldCreateForm` is the unified screen's own switch between the listing and link forms.
    expect(mounts.map((p) => relative(MOBILE, p)).sort()).toEqual([
      'app/create.tsx',
      'src/components/CreatePostForm/WorldCreateForm.tsx',
    ]);
  });

  // FR-DONATE-001 AC6: the marketplace browse screen is gone; nothing may link to it again.
  it('nothing navigates to the removed marketplace browse screen', () => {
    const browseLink = /['"`]\/\(tabs\)\/donations\/marketplace['"`]/;
    const offenders = files.filter((p) => browseLink.test(readFileSync(p, 'utf8')));
    expect(offenders.map((p) => relative(MOBILE, p))).toEqual([]);
  });
});
