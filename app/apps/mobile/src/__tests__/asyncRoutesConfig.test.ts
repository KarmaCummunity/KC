// NFR-PERF-005 — the web export loads a route's code on demand (expo-router `asyncRoutes`), so the
// entry bundle does not carry every screen. Native keeps synchronous routes: a lazy route there
// would show a loading fallback on every first navigation for no download saving.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type Plugin = string | [string, Record<string, unknown>?];

const appJson = JSON.parse(readFileSync(join(__dirname, '..', '..', 'app.json'), 'utf8')) as {
  expo: { plugins: Plugin[] };
};

describe('expo-router asyncRoutes', () => {
  const router = appJson.expo.plugins.find((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-router');

  it('splits routes into on-demand chunks on web only', () => {
    expect(Array.isArray(router) ? router[1] : undefined).toEqual({ asyncRoutes: { web: true, default: false } });
  });
});
