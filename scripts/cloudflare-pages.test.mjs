// Unit tests for scripts/cloudflare-pages.mjs. Run: node --test scripts/cloudflare-pages.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentProduction, pagesApi } from './cloudflare-pages.mjs';

const ENV = { CLOUDFLARE_API_TOKEN: 'tok', CLOUDFLARE_ACCOUNT_ID: 'acc', CF_PAGES_PROJECT: 'karma-community' };
const ID = '0b6a1b7e-7f7a-4c4b-9c1d-2f1e5d6a7b8c';

test('currentProduction returns the live deployment id and commit', () => {
  const project = {
    production_branch: 'main',
    canonical_deployment: { id: ID, deployment_trigger: { metadata: { commit_hash: 'abc' } } },
  };
  assert.deepEqual(currentProduction(project, 'main'), { previous_id: ID, previous_commit: 'abc' });
});

test('currentProduction refuses a project whose production branch is not the release branch', () => {
  assert.throws(() => currentProduction({ production_branch: 'dev' }, 'main'), /production branch is "dev", expected "main"/);
});

test('currentProduction tolerates a project with no production deployment yet', () => {
  assert.deepEqual(currentProduction({ production_branch: 'main' }, 'main'), { previous_id: '', previous_commit: '' });
});

test('pagesApi calls the project URL with the bearer token and returns result', async () => {
  let seen;
  const fetch = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, json: async () => ({ success: true, result: { id: ID } }) };
  };
  const result = await pagesApi({ env: ENV, fetch, method: 'POST', path: `/deployments/${ID}/rollback` });
  assert.deepEqual(result, { id: ID });
  assert.equal(seen.url, `https://api.cloudflare.com/client/v4/accounts/acc/pages/projects/karma-community/deployments/${ID}/rollback`);
  assert.equal(seen.init.headers.Authorization, 'Bearer tok');
});

test('pagesApi surfaces Cloudflare error messages', async () => {
  const fetch = async () => ({ ok: false, status: 403, json: async () => ({ success: false, errors: [{ message: 'Authentication error' }] }) });
  await assert.rejects(pagesApi({ env: ENV, fetch }), /failed: Authentication error/);
});
