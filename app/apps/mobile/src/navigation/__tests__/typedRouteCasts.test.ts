// TD-127 (1) — static routes must stay checked by expo-router typed routes.
// A cast like `router.push('/settings/feed' as never)` hides a renamed or
// deleted route until runtime. Casts are allowed only on dynamic values
// (notification links, a saved post-login path), never on a literal.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** A quoted or template route literal (or `{ pathname: '…' }`) followed by a type escape. */
const CAST_ON_LITERAL =
  /(?:['`]\/[^'`]*['`]|pathname:\s*'[^']+'(?:,\s*params:\s*\{[^{}]*\})?\s*\})\s+as\s+(?:never|any|Href|unknown|Parameters<typeof router\.\w+>\[0\])/;

describe('typed route casts', () => {
  it('no static route literal is cast past the typed-route check', () => {
    const offenders = ['app', 'src']
      .flatMap((d) => walk(join(ROOT, d)))
      .flatMap((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          .map((line, i) => ({ line, at: `${relative(ROOT, f)}:${i + 1}` }))
          .filter(({ line }) => CAST_ON_LITERAL.test(line))
          .map(({ at }) => at),
      );
    expect(offenders).toEqual([]);
  });

  it('detects the escape forms it guards against', () => {
    expect(CAST_ON_LITERAL.test("router.push('/settings/feed' as never)")).toBe(true);
    expect(CAST_ON_LITERAL.test('router.push(`/post/${id}` as Href)')).toBe(true);
    expect(CAST_ON_LITERAL.test("router.push({ pathname: '/user/[handle]', params: { handle } } as never)")).toBe(true);
    expect(CAST_ON_LITERAL.test('router.push(link as never)')).toBe(false);
  });
});
