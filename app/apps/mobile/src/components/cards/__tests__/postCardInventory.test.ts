// Regression guard for "every post renders through ONE base card" (KcCard).
// Fails if a screen/component renders a post or listing title with its own ad-hoc card,
// or if a removed legacy card comes back.
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const SCAN_DIRS = ['app', 'src'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d))).map((f) => ({
  rel: relative(ROOT, f).split('\\').join('/'),
  src: readFileSync(f, 'utf8'),
}));

/** A <Text> that prints a post / listing / match title directly. */
const RAW_POST_TITLE = /<Text[^>]*>\s*\{\s*(?:cleanDisplayTitle\()?(?:post|item|listing|match|m|p|detail)\.(?:title|otherListingTitle)\b/;

/**
 * Non-post rows that legitimately print an entity's own title (admin sections, roadmap,
 * the donations-hub matches summary link) — not post cards.
 * Adding to this list needs a reason in the PR.
 */
const ALLOWED = new Set([
  'src/components/cards/KcCard.tsx',
  'src/components/cards/KcRowCard.tsx',
  'src/components/admin/admins/AdminsListView.tsx',
  'src/features/about-landing/AboutRoadmapTimeline.tsx',
  // Donations-hub summary link (one-line text list → /matches), not a post card.
  'src/components/matching/MatchesForYouCard.tsx',
]);

describe('post card inventory', () => {
  it('no surface renders a post title outside the base card', () => {
    const offenders = files.filter((f) => !ALLOWED.has(f.rel) && RAW_POST_TITLE.test(f.src)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it('legacy one-off post card is gone', () => {
    expect(existsSync(join(ROOT, 'src/components/PostCard.tsx'))).toBe(false);
    const importsLegacy = files.filter((f) => /components\/PostCard'|from '\.\/PostCard'/.test(f.src)).map((f) => f.rel);
    expect(importsLegacy).toEqual([]);
  });

  it.each([
    ['src/components/PostCardGrid.tsx', 'KcCard'],
    ['src/components/cards/ListingCard.tsx', 'KcCard'],
    ['src/components/cards/SimilarListingCard.tsx', 'KcCard'],
    ['src/components/matching/MatchSuggestionCard.tsx', 'KcCard'],
    ['src/components/search/PostResultCard.tsx', 'PostCardGrid'],
    ['src/components/marketplace/MarketplaceListingDetailView.tsx', 'SimilarListingCard'],
    ['src/components/marketplace/MarketplaceListingDetailView.tsx', 'PostDetailHeader'],
    ['app/(guest)/feed.tsx', 'PostCardGrid'],
    ['app/(tabs)/donations/time/my-shifts.tsx', 'KcRowCard'],
    ['src/components/giving/time/TimeOpportunitiesSection.tsx', 'KcRowCard'],
    ['src/components/giving/WorldMarketplaceHub.tsx', 'PostFeedList'],
    ['app/(tabs)/donations/time/organizer/index.tsx', 'KcRowCard'],
    ['app/(tabs)/donations/marketplace/my-listings.tsx', 'KcRowCard'],
    ['src/components/giving/MyWorldHandoffsList.tsx', 'KcRowCard'],
    ['src/components/giving/RidesFeedList.tsx', 'ListingCard'],
    ['src/components/chat/AnchoredPostCard.tsx', 'KcRowCard'],
  ])('%s renders through %s', (rel, base) => {
    const f = files.find((x) => x.rel === rel);
    expect(f, rel).toBeDefined();
    expect(f!.src).toMatch(new RegExp(`<${base}\\b`));
  });

  it('similar-listings carousel filters automated-test listings', () => {
    const f = files.find((x) => x.rel === 'src/components/marketplace/MarketplaceListingDetailView.tsx');
    expect(f!.src).toMatch(/isTestListingTitle/);
  });

  describe.each([
    ['src/components/chat/AnchoredPostCard.tsx', "pathname: '/post/[id]'"],
  ])('chat preview %s', (rel, fullPageRoute) => {
    const src = () => files.find((x) => x.rel === rel)!.src;
    it('uses the compact row card with an "open full post" link', () => {
      expect(src()).toMatch(/<KcRowCard\b/);
      expect(src()).toMatch(/openLinkLabel=\{t\('cards\.openFullPost'\)\}/);
    });
    it('taps through to the full post page', () => {
      expect(src()).toContain(fullPageRoute);
    });
    it('never renders the full post body inline', () => {
      expect(src()).not.toMatch(/\.(description|body|summary)\b/);
      expect(src()).not.toMatch(/<KcCard\b|<PostCardGrid\b/);
    });
  });
});
