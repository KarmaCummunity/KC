// Guard: the production web-server image installs its dependencies from
// app/pnpm-lock.yaml (`pnpm deploy`), never with a lockfile-less `npm install`
// that resolves whatever is newest at build time (CTO audit P1-4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');
const [builder, runner] = dockerfile.split(/^FROM .* AS runner$/m);

test('the builder stage deploys the web-server package from the pnpm lockfile', () => {
  assert.match(builder, /pnpm --filter @kc\/web-server deploy --prod/);
});

test('the runner stage installs nothing and copies the deployed node_modules', () => {
  assert.ok(runner, 'Dockerfile has no runner stage');
  assert.doesNotMatch(runner, /\b(npm|pnpm|yarn) (install|i|ci|add)\b/);
  assert.match(runner, /COPY --from=builder \/repo\/web-server-deploy\/node_modules/);
});
