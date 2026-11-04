import { execFileSync } from 'node:child_process';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { touchedFiles, touchedRuleSkipReason } from './guardKit/ratchet';

// Pins where the touched-file rule applies (spec 17 §6, D67): feature work on its way
// into `dev`. A push to `main` and a dev → main release PR carry a whole release whose
// files were already gated on their own PRs, so diffing them against `origin/dev` would
// flag every file changed since the previous release.

describe('touchedRuleSkipReason', () => {
  it('skips a push to main', () => {
    expect(touchedRuleSkipReason({ GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' })).not.toBeNull();
  });

  it('skips a dev → main release PR', () => {
    expect(touchedRuleSkipReason({ GITHUB_BASE_REF: 'main', GITHUB_HEAD_REF: 'dev' })).not.toBeNull();
  });

  it('applies to a feature PR into dev', () => {
    expect(touchedRuleSkipReason({ GITHUB_BASE_REF: 'dev', GITHUB_HEAD_REF: 'feat/FR-X-001-y' })).toBeNull();
  });

  it('applies to a non-release PR into main', () => {
    expect(touchedRuleSkipReason({ GITHUB_BASE_REF: 'main', GITHUB_HEAD_REF: 'fix/hotfix-z' })).toBeNull();
  });

  it('applies to a push to dev and to a local run', () => {
    expect(touchedRuleSkipReason({ GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/dev' })).toBeNull();
    expect(touchedRuleSkipReason({})).toBeNull();
  });

  it('applies when the base is overridden explicitly', () => {
    const env = { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', KC_BRAND_BASE_REF: 'origin/dev' };
    expect(touchedRuleSkipReason(env)).toBeNull();
  });
});

describe('touchedFiles on a push to main', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('reports nothing instead of the whole release diff', () => {
    // The root commit makes the diff cover every file in the repo, so a rule that did not skip would list them.
    const rootCommit = execFileSync('git', ['rev-list', '--max-parents=0', 'HEAD'], { encoding: 'utf8' }).split('\n')[0];
    vi.stubEnv('GITHUB_EVENT_NAME', 'push');
    vi.stubEnv('GITHUB_REF', 'refs/heads/main');
    vi.stubEnv('KC_BRAND_BASE_REF', '');
    expect(touchedFiles(rootCommit, () => true)).toEqual([]);
  });
});
