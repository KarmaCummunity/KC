// KC#1296 — world subcategories for the create form's picker.
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../database.types';
import { listWorldSubcategories } from '../listWorldSubcategories';

type Result = { data: unknown; error: unknown };

/** Query-builder fake that records every filter and resolves `order` with `result`. */
function client(result: Result) {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'not']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.order = (...args: unknown[]) => {
    calls.push(['order', ...args]);
    return Promise.resolve(result);
  };
  const c = {
    from: (table: string) => {
      calls.push(['from', table]);
      return builder;
    },
  } as unknown as SupabaseClient<Database>;
  return { c, calls };
}

describe('listWorldSubcategories', () => {
  it('reads the active child rows of the world in display order and maps them', async () => {
    const { c, calls } = client({
      data: [
        { category_id: 'c1', slug: 'books', label_he: 'ספרים', label_en: 'Books' },
        { category_id: 'c2', slug: 'medical-second-hand', label_he: 'רפואי יד שנייה', label_en: null },
      ],
      error: null,
    });

    const rows = await listWorldSubcategories(c, 'items');

    expect(rows).toEqual([
      { categoryId: 'c1', slug: 'books', labelHe: 'ספרים', labelEn: 'Books' },
      { categoryId: 'c2', slug: 'medical-second-hand', labelHe: 'רפואי יד שנייה', labelEn: null },
    ]);
    expect(calls).toEqual([
      ['from', 'categories'],
      ['select', 'category_id, slug, label_he, label_en'],
      ['eq', 'world_slug', 'items'],
      ['eq', 'is_active', true],
      ['not', 'parent_id', 'is', null],
      ['order', 'sort_order'],
    ]);
  });

  it('returns an empty list when the read fails, so the optional picker just hides', async () => {
    const { c } = client({ data: null, error: { message: 'network' } });
    await expect(listWorldSubcategories(c, 'food')).resolves.toEqual([]);
  });
});
