// app/apps/mobile/src/lib/__tests__/coreLoopFunnelInventory.test.ts
//
// #1042 / #1055 — every publish path of the unified create form feeds the core-loop funnel:
// `listing_created` on each publish and `activation` (with the account creation time, sent as
// `seconds_since_signup`) on the first one. The post engine (items category) used to emit
// neither, so first posts made from the default form were never measured.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..');
const PUBLISH_PATHS = {
  'post engine': join(SRC, 'hooks', 'useCreatePostPublish.ts'),
  'listing engine': join(SRC, 'hooks', 'useListingCreateForm.ts'),
} as const;

describe('core-loop funnel on publish', () => {
  for (const [engine, file] of Object.entries(PUBLISH_PATHS)) {
    const source = readFileSync(file, 'utf8');

    it(`${engine} emits listing_created`, () => {
      expect(source).toMatch(/trackCoreLoop\('listing_created'/);
    });

    it(`${engine} emits activation with the account creation time`, () => {
      expect(source).toMatch(/trackActivationIfFirst\(/);
      expect(source).toMatch(/accountCreatedAt: useAuthStore\.getState\(\)\.session\?\.accountCreatedAt/);
    });
  }
});
