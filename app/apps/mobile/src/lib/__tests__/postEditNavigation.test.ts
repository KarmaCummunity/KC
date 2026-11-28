// #2238 — owner-edit URLs from hrefForPostEdit must be claimed by Android
// app links and the path-scoped iOS AASA, and must resolve to real expo-router screens.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hrefForPostEdit } from '../postEditNavigation';

const MOBILE_ROOT = join(__dirname, '../../..');
const APP_HOST = 'karma-community-kc.com';
const EDIT_ANDROID_PREFIXES = ['/edit-post/', '/edit-listing/'] as const;
const EDIT_AASA_PATHS = ['/edit-post/*', '/edit-listing/*'] as const;

type IntentData = { scheme: string; host: string; pathPrefix?: string };
type IntentFilter = {
  action: string;
  autoVerify: boolean;
  category: string[];
  data: IntentData[];
};
type Association = { appID: string; paths: string[] };

function loadExpoConfig() {
  return JSON.parse(readFileSync(join(MOBILE_ROOT, 'app.json'), 'utf8')).expo as {
    android: { intentFilters: IntentFilter[] };
    ios: { associatedDomains: string[] };
  };
}

function loadAasa() {
  return JSON.parse(
    readFileSync(join(MOBILE_ROOT, 'public/.well-known/apple-app-site-association'), 'utf8'),
  ) as { applinks: { details: Association[] } };
}

/** Verified HTTPS VIEW filters that admit the installed app (same block as `/post`). */
function verifiedHttpsIntentData(filters: IntentFilter[]): IntentData[] {
  return filters
    .filter(
      (f) =>
        f.action === 'VIEW' &&
        f.autoVerify === true &&
        f.category.includes('BROWSABLE') &&
        f.category.includes('DEFAULT'),
    )
    .flatMap((f) => f.data);
}

describe('hrefForPostEdit', () => {
  it('routes native listing worlds to edit-listing', () => {
    expect(
      hrefForPostEdit({ postId: 'p1', listingId: 'l1', listingWorldSlug: 'rides' }),
    ).toBe('/edit-listing/p1');
    expect(
      hrefForPostEdit({ postId: 'p2', listingId: 'l2', listingWorldSlug: 'food' }),
    ).toBe('/edit-listing/p2');
  });

  it('routes items and plain posts to edit-post', () => {
    expect(hrefForPostEdit({ postId: 'p3', listingId: null, listingWorldSlug: null })).toBe(
      '/edit-post/p3',
    );
    expect(
      hrefForPostEdit({ postId: 'p4', listingId: 'l4', listingWorldSlug: 'items' }),
    ).toBe('/edit-post/p4');
  });
});

describe('native edit URL registration (#2238)', () => {
  const config = loadExpoConfig();
  const aasa = loadAasa();
  const intentData = verifiedHttpsIntentData(config.android.intentFilters);
  const aasaDetail = aasa.applinks.details.find(
    (d) => d.appID === 'HVW3H3DLRB.org.karmacommunity.app',
  );

  it.each([
    { postId: 'p1', listingId: null, listingWorldSlug: null },
    { postId: 'p2', listingId: 'l2', listingWorldSlug: 'rides' as const },
  ])('claims $href via verified Android HTTPS intent', (target) => {
    const href = hrefForPostEdit(target);
    expect(
      intentData.some(
        (d) =>
          d.scheme === 'https' &&
          d.host === APP_HOST &&
          typeof d.pathPrefix === 'string' &&
          href.startsWith(d.pathPrefix),
      ),
    ).toBe(true);
  });

  it('registers both edit path prefixes beside /post on the same verified filter', () => {
    for (const prefix of EDIT_ANDROID_PREFIXES) {
      expect(
        intentData.filter(
          (d) => d.scheme === 'https' && d.host === APP_HOST && d.pathPrefix === prefix,
        ),
      ).toHaveLength(1);
    }
    expect(
      intentData.some((d) => d.scheme === 'https' && d.host === APP_HOST && d.pathPrefix === '/post'),
    ).toBe(true);
    // Keep claims scoped — a bare "/" would steal every HTTPS path on the host.
    expect(intentData.some((d) => d.pathPrefix === '/' || !d.pathPrefix)).toBe(false);
  });

  it('claims edit paths on the path-restricted iOS AASA (associatedDomains already cover the host)', () => {
    expect(config.ios.associatedDomains).toContain(`applinks:${APP_HOST}`);
    expect(aasaDetail?.paths).toEqual(expect.arrayContaining([...EDIT_AASA_PATHS]));
    // AASA is path-restricted in-repo; a catch-all would make the edit entries redundant.
    expect(aasaDetail?.paths).not.toContain('*');
    expect(aasaDetail?.paths).not.toContain('/*');
  });

  it('lands generated hrefs on existing expo-router edit screens that read :id', () => {
    for (const target of [
      { postId: 'item-1', listingId: null, listingWorldSlug: null },
      { postId: 'ride-1', listingId: 'l1', listingWorldSlug: 'rides' as const },
    ]) {
      const href = hrefForPostEdit(target);
      const routeFile = join(MOBILE_ROOT, 'app', href.split('/')[1]!, '[id].tsx');
      expect(existsSync(routeFile), `missing route for ${href}`).toBe(true);
      const source = readFileSync(routeFile, 'utf8');
      expect(source).toMatch(/useLocalSearchParams<\s*\{\s*id:\s*string\s*\}/);
    }
  });
});
