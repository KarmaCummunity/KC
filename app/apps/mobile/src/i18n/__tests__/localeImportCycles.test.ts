// Locale modules build one object graph at import time, so an import cycle among them reads a
// const before it is initialized and crashes the web bundle at load (a temporal-dead-zone
// error seen in the merge-queue smoke). This guard parses the relative value imports of every
// locale module and fails on any cycle.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCALES_DIR = resolve(__dirname, '../locales');
// `import { a } from './x'` and `export … from './x'`; `import type` creates no runtime edge.
const VALUE_IMPORT = /^\s*(?:import|export)\s+(?!type\b)[^'"]*?from\s+'(\.[^']+)'/gm;

/** Every .ts file under a directory, as absolute paths. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}

/** The locale module a relative specifier names (a file or a folder's index), if any. */
function resolveModule(from: string, specifier: string, known: ReadonlySet<string>): string | null {
  const base = resolve(dirname(from), specifier);
  return [`${base}.ts`, join(base, 'index.ts')].find((candidate) => known.has(candidate)) ?? null;
}

/** The first import cycle found, as a list of modules relative to the locales folder; null if none. */
function findCycle(graph: ReadonlyMap<string, readonly string[]>): string[] | null {
  const state = new Map<string, 'open' | 'done'>();
  const stack: string[] = [];
  const visit = (node: string): string[] | null => {
    if (state.get(node) === 'done') return null;
    if (state.get(node) === 'open') return stack.slice(stack.indexOf(node)).concat(node);
    state.set(node, 'open');
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(node, 'done');
    return null;
  };
  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle.map((path) => path.slice(LOCALES_DIR.length + 1));
  }
  return null;
}

describe('locale modules', () => {
  it('import each other without a cycle', () => {
    const files = sourceFiles(LOCALES_DIR);
    const known = new Set(files);
    const graph = new Map(files.map((file) => [file,
      [...readFileSync(file, 'utf8').matchAll(VALUE_IMPORT)]
        .map((match) => resolveModule(file, match[1]!, known))
        .filter((target): target is string => target !== null)]));
    expect(graph.size).toBeGreaterThan(50);
    expect(findCycle(graph)).toBeNull();
  });
});
