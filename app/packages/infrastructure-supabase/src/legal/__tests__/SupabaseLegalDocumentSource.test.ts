import { LegalDocumentNotPublishedError } from '@kc/application';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Database } from '../../database.types';
import { SupabaseLegalDocumentSource } from '../SupabaseLegalDocumentRepository';

/** What a single-row read of one table answers. */
interface Answer {
  data: unknown;
  error: { code?: string; message: string } | null;
}

/** A client whose `from(table)…single()` answers `answers[table]`. */
function clientAnswering(answers: Record<string, Answer>): SupabaseClient<Database> {
  const chain = (table: string): unknown => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      single: () => Promise.resolve(answers[table]),
    };
    return builder;
  };
  return { from: chain } as unknown as SupabaseClient<Database>;
}

const NO_ROW: Answer = { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
const POINTER: Answer = { data: { current_version: 2 }, error: null };
const VERSION: Answer = {
  data: {
    doc_type: 'terms',
    version: 2,
    effective_date: '2026-01-01T00:00:00Z',
    body_md: 'The terms.',
    content_hash: 'hash-2',
    severity: 'standard',
    change_summary: 'Second version',
    published_at: '2025-12-25T08:00:00Z',
  },
  error: null,
};

describe('SupabaseLegalDocumentSource.getCurrentContent', () => {
  it('returns the current version of a published document', async () => {
    const source = new SupabaseLegalDocumentSource(clientAnswering({ legal_documents: POINTER, legal_document_versions: VERSION }));

    const content = await source.getCurrentContent('terms');

    expect(content).toMatchObject({ docType: 'terms', version: 2, bodyMd: 'The terms.' });
    expect(content.effectiveDate.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('refuses with LegalDocumentNotPublishedError when the document has no pointer or no version row', async () => {
    const noPointer = new SupabaseLegalDocumentSource(clientAnswering({ legal_documents: NO_ROW }));
    const noVersion = new SupabaseLegalDocumentSource(clientAnswering({ legal_documents: POINTER, legal_document_versions: NO_ROW }));

    for (const source of [noPointer, noVersion]) {
      const refusal = await source.getCurrentContent('privacy').then(() => null, (error: unknown) => error);

      expect(refusal).toBeInstanceOf(LegalDocumentNotPublishedError);
      expect((refusal as LegalDocumentNotPublishedError).docType).toBe('privacy');
    }
  });

  it('keeps a read that failed for another reason a plain error: the document may well exist', async () => {
    const refused = new SupabaseLegalDocumentSource(clientAnswering({ legal_documents: { data: null, error: { code: '42501', message: 'permission denied' } } }));

    const failure = await refused.getCurrentContent('terms').then(() => null, (error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(LegalDocumentNotPublishedError);
    expect((failure as Error).message).toBe('legal:getCurrentContent failed for terms: permission denied');
  });
});
