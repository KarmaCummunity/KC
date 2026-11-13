// #2060 — the report sheets showed the raw key `common.cancel` because it did not exist in the
// locale. The component tests mock i18n and echo keys, so they cannot catch that: this guard reads
// the report modals' source and requires every literal `t('…')` key to resolve in both locales.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import he from '../locales/he';
import en from '../locales/en';

const REPORT_MODALS = [
  'components/post/ReportPostModal.tsx',
  'components/ReportChatModal.tsx',
  'components/marketplace/ReportListingModal.tsx',
  'components/profile/ReportUserModal.tsx',
] as const;

/** Walks a dotted key through a resource tree; undefined when any segment is missing. */
function resolveKey(tree: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], tree);
}

describe.each(REPORT_MODALS)('%s translation keys (#2060)', (file) => {
  const source = readFileSync(path.resolve(__dirname, '../../', file), 'utf8');
  const keys = [...source.matchAll(/\bt\('([\w.]+)'\)/g)].map((match) => match[1]);

  it('uses at least one translation key', () => {
    expect(keys.length).toBeGreaterThan(0);
  });

  it.each(['he', 'en'] as const)('resolves every key in the %s locale', (lang) => {
    const tree = lang === 'he' ? he : en;
    const missing = keys.filter((key) => typeof resolveKey(tree, key) !== 'string');
    expect(missing).toEqual([]);
  });
});
