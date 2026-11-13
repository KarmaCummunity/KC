import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPOSED_SCHEMAS,
  GENERATOR,
  OUTPUT_FILE,
  firstDifference,
  isLocalAddress,
  parseArgs,
  scratchUrl,
  shapeProblems,
} from './gen-baseline-types.mjs';

const TYPES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'app/packages/infrastructure-supabase/src');

const MINIMAL = `export type Json =
  | string

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
        }
        Insert: {
          id?: string
        }
        Update: {
          id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ping: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type Tables<T> = T
export type TablesInsert<T> = T
export type TablesUpdate<T> = T
export type Enums<T> = T
export type CompositeTypes<T> = T

export const Constants = {
  public: {
    Enums: {},
  },
} as const
`;

test('parseArgs reads the three flags and rejects anything else', () => {
  assert.deepEqual(parseArgs([]), { check: false, build: true, stdout: false });
  assert.deepEqual(parseArgs(['--check', '--no-build', '--stdout']), { check: true, build: false, stdout: true });
  assert.throws(() => parseArgs(['--force']), /unknown argument/);
});

test('only local server addresses are accepted', () => {
  for (const address of ['socket', '127.0.0.1', '::1', '172.17.0.2', '192.168.1.5', '10.0.0.3']) {
    assert.equal(isLocalAddress(address), true, address);
  }
  for (const address of ['34.120.5.1', '8.8.8.8', '2a05:d014::1', '']) assert.equal(isLocalAddress(address), false, address);
});

test('scratchUrl swaps the database and refuses a name that is not a plain identifier', () => {
  assert.equal(scratchUrl('postgresql://postgres@127.0.0.1:55432/postgres', 'kc_x'), 'postgresql://postgres@127.0.0.1:55432/kc_x');
  assert.throws(() => scratchUrl('postgresql://postgres@127.0.0.1/postgres', 'x; drop database y'), /invalid scratch database name/);
  assert.throws(() => scratchUrl('postgresql://postgres@127.0.0.1/postgres', 'Upper'), /invalid scratch database name/);
});

test('a minimal file in the generator layout has no shape problems', () => {
  assert.deepEqual(shapeProblems(MINIMAL), []);
});

test('shape problems name what is wrong', () => {
  assert.match(shapeProblems(MINIMAL.replace('  public: {', '  graphql_public: {\n  }\n  public: {')).join('\n'), /schemas are \[graphql_public, public\]/);
  assert.match(shapeProblems(MINIMAL.replace('    Views: {', '    Vues: {')).join('\n'), /public sections are/);
  assert.match(shapeProblems(MINIMAL.replace('export type TablesInsert<T> = T\n', '')).join('\n'), /helper type TablesInsert is missing/);
  assert.match(shapeProblems(MINIMAL.replace('      users: {', '      feed_impressions_y2026m11: {')).join('\n'), /monthly partition child/);
  assert.match(shapeProblems('type X = 1').join('\n'), /no `export type Database` block/);
});

test('firstDifference reports the first differing line', () => {
  assert.equal(firstDifference('a\nb\n', 'a\nb\n'), null);
  assert.deepEqual(firstDifference('a\nb\n', 'a\nc\n'), { line: 2, expected: 'b', actual: 'c' });
  assert.deepEqual(firstDifference('a', 'a\nb'), { line: 2, expected: '<end of file>', actual: 'b' });
});

test('the generator and its formatter are pinned to exact versions', () => {
  for (const version of [GENERATOR.version, GENERATOR.prettier]) assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(EXPOSED_SCHEMAS, ['public']);
});

// The committed files prove the convention: the file CI generates with the Supabase CLI
// and the baseline file generated here have the same layout.
test('the frozen pre-baseline types (Supabase CLI) have the layout this script checks for', () => {
  const frozen = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs/db/pre-baseline-schema.types.ts');
  assert.deepEqual(shapeProblems(readFileSync(frozen, 'utf8')), []);
});

test('the committed baseline types have the same layout and the same helper types', () => {
  assert.equal(existsSync(OUTPUT_FILE), true, 'run: node scripts/gen-baseline-types.mjs');
  const baseline = readFileSync(OUTPUT_FILE, 'utf8');
  assert.deepEqual(shapeProblems(baseline), []);
  const helpers = (source) => source.slice(source.indexOf('\ntype DatabaseWithoutInternals'), source.indexOf('\nexport const Constants'));
  assert.equal(helpers(baseline), helpers(readFileSync(join(TYPES_DIR, 'database.types.ts'), 'utf8')));
  for (const name of ['users', 'posts', 'post_handoffs', 'notifications']) assert.match(baseline, new RegExp(`^      ${name}: \\{$`, 'm'));
  for (const name of ['bootstrap_session', 'feed_page']) assert.match(baseline, new RegExp(`^      ${name}: `, 'm'));
});
