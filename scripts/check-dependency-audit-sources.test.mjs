import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AuditSourceError,
  collectInventory,
  parseEdgeFunctionImports,
  parseNpmLock,
  parsePnpmLock,
  parserFor,
} from './check-dependency-audit-sources.mjs';

const PNPM_LOCK = `lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      left-pad:
        specifier: ^1.3.0
        version: 1.3.0

packages:
  '@babel/core@7.29.0':
    resolution: {integrity: sha512-x}
  left-pad@1.3.0:
    resolution: {integrity: sha512-y}
  odd-dep@https://example.com/odd.tgz:
    resolution: {tarball: https://example.com/odd.tgz}

snapshots:
  left-pad@1.3.0: {}
`;

test('parsePnpmLock reads scoped and plain package keys', () => {
  const { refs } = parsePnpmLock(PNPM_LOCK, 'app/pnpm-lock.yaml');
  assert.deepEqual(refs, [
    { name: '@babel/core', version: '7.29.0', source: 'app/pnpm-lock.yaml' },
    { name: 'left-pad', version: '1.3.0', source: 'app/pnpm-lock.yaml' },
  ]);
});

test('parsePnpmLock reports a non-registry package as unauditable', () => {
  const { unauditable } = parsePnpmLock(PNPM_LOCK, 'app/pnpm-lock.yaml');
  assert.equal(unauditable.length, 1);
  assert.match(unauditable[0].specifier, /odd\.tgz/);
});

test('parsePnpmLock rejects a lockfile format it does not know', () => {
  assert.throws(
    () => parsePnpmLock("lockfileVersion: '6.0'\npackages: {}\n", 'old/pnpm-lock.yaml'),
    AuditSourceError,
  );
});

test('parseNpmLock reads nested installs and aliases, skipping root and links', () => {
  const lock = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': { name: 'root' },
      'node_modules/yaml': { version: '2.9.1' },
      'node_modules/a/node_modules/@scope/b': { version: '1.0.0' },
      'node_modules/alias': { name: 'real-name', version: '3.1.0' },
      'node_modules/workspace-pkg': { link: true, resolved: 'packages/x' },
    },
  });
  const { refs, unauditable } = parseNpmLock(lock, 'scripts/package-lock.json');
  assert.deepEqual(
    refs.map((ref) => `${ref.name}@${ref.version}`),
    ['yaml@2.9.1', '@scope/b@1.0.0', 'real-name@3.1.0'],
  );
  assert.deepEqual(unauditable, []);
});

test('parseNpmLock rejects lockfile v1, which has no packages map', () => {
  const lock = JSON.stringify({ lockfileVersion: 1, dependencies: {} });
  assert.throws(() => parseNpmLock(lock, 'x/package-lock.json'), AuditSourceError);
});

test('parseEdgeFunctionImports reads exact esm.sh and npm: pins', () => {
  const source = [
    "import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno';",
    "import { Jimp } from 'https://esm.sh/jimp@1.6.0';",
    "import Stripe from 'npm:stripe@17.2.0';",
    "import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';",
  ].join('\n');
  const { refs, unauditable } = parseEdgeFunctionImports(source, 'supabase/functions/x/index.ts');
  assert.deepEqual(
    refs.map((ref) => `${ref.name}@${ref.version}`),
    ['@supabase/supabase-js@2.45.4', 'jimp@1.6.0', 'stripe@17.2.0'],
  );
  assert.deepEqual(unauditable, []);
});

test('parseEdgeFunctionImports reports a version range as unauditable', () => {
  const { refs, unauditable } = parseEdgeFunctionImports(
    "import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';",
    'supabase/functions/y/index.ts',
  );
  assert.deepEqual(refs, []);
  assert.deepEqual(unauditable, [
    { specifier: '@supabase/supabase-js@2', source: 'supabase/functions/y/index.ts' },
  ]);
});

test('parserFor picks lockfiles anywhere and Edge Function sources only', () => {
  assert.equal(parserFor('app/pnpm-lock.yaml'), parsePnpmLock);
  assert.equal(parserFor('tests/e2e/package-lock.json'), parseNpmLock);
  assert.equal(parserFor('supabase/functions/translate/index.ts'), parseEdgeFunctionImports);
  assert.equal(parserFor('supabase/migrations/0001_init.sql'), null);
  assert.equal(parserFor('app/apps/mobile/src/index.ts'), null);
});

test('collectInventory groups versions and the files that record them', () => {
  const files = {
    'b/package-lock.json': JSON.stringify({
      lockfileVersion: 3,
      packages: { '': {}, 'node_modules/left-pad': { version: '1.3.0' } },
    }),
    'a/pnpm-lock.yaml': PNPM_LOCK,
    'README.md': 'not read',
  };
  const inventory = collectInventory(Object.keys(files), (path) => files[path]);
  assert.deepEqual(inventory.sources, ['a/pnpm-lock.yaml', 'b/package-lock.json']);
  assert.deepEqual(inventory.packages.get('left-pad').get('1.3.0'), [
    'a/pnpm-lock.yaml',
    'b/package-lock.json',
  ]);
  assert.equal(inventory.packages.get('@babel/core').size, 1);
  assert.equal(inventory.unauditable.length, 1);
});
