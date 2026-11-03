// app/apps/mobile/src/components/profile/__tests__/otherProfileKarmaHidden.test.ts
//
// FR-KARMA (legacy `docs/SSOT/spec/14_karma.md`, visibility AC1) and the
// project book D29 (`docs/spec/07_cross_cutting_systems.md` §7.6): karma is
// visible to its owner only. Another user's profile must not render a karma
// value (it also has no data for it: `karma_points` is not a public column).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const OTHER_PROFILE_SCREEN = join(__dirname, '..', '..', '..', '..', 'app', 'user', '[handle]', 'index.tsx');

describe('other-user profile screen', () => {
  it('does not render the viewed user\'s karma points', () => {
    const source = readFileSync(OTHER_PROFILE_SCREEN, 'utf8');

    expect(source).not.toMatch(/karmaPoints/);
    expect(source).not.toMatch(/KarmaBadge/);
  });
});
