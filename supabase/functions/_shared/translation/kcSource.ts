// supabase/functions/_shared/translation/kcSource.ts — FR-TRANSLATE-002 / 006 (KC).
//
// KC UGC source registry + field resolver for the `translate` Edge Function.
// One entry per `content_type` of public.content_translations
// (supabase/schemas/78_translation/010_content_translations.sql); the fields are the ones its
// check constraint allows. Rides are posts, so there is no separate ride entry.
// Anti-poisoning: text is always re-read from these rows server-side, never
// from the request body. Proper names (display_name, share_handle) are absent.

export interface SourceEntry {
  table: string;
  pk: string;
  fields: Record<string, string>;
  arrayFields?: Set<string>;
}

export const SOURCE: Record<string, SourceEntry> = {
  post: {
    table: 'posts',
    pk: 'id',
    fields: { title: 'title', description: 'description' },
  },
  comment: {
    table: 'post_comments',
    pk: 'id',
    fields: { body: 'body' },
  },
  message: {
    table: 'messages',
    pk: 'id',
    fields: { body: 'body' },
  },
  user: {
    table: 'users',
    pk: 'id',
    fields: { biography: 'biography' },
  },
};

export function resolveField(
  src: SourceEntry | undefined,
  field: string,
): { column: string; index: number | null } | null {
  if (!src) return null;
  const dot = field.lastIndexOf('.');
  if (dot === -1) {
    return src.fields[field] ? { column: src.fields[field], index: null } : null;
  }
  const base = field.slice(0, dot);
  const idx = field.slice(dot + 1);
  if (!/^\d+$/.test(idx)) return null;
  if (!src.arrayFields?.has(base) || !src.fields[base]) return null;
  return { column: src.fields[base], index: Number(idx) };
}
