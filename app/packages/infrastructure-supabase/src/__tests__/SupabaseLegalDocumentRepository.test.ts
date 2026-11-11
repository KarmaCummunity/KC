import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.legacy.types';
import { SupabaseLegalDocumentRepository } from '../legal/SupabaseLegalDocumentRepository';
import { LegalDocumentCache, type AsyncKVStorage } from '../legal/legalCache';

function makeMemStorage(): AsyncKVStorage {
  const map = new Map<string, string>();
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v);
    },
    removeItem: async (k) => {
      map.delete(k);
    },
  };
}

function makeClient(overrides: {
  pointerResult?: { data: { current_version: number } | null; error: { message: string } | null };
  versionResult?: { data: unknown; error: { message: string } | null };
  rpcResults?: Record<string, { data: unknown; error: { message: string } | null }>;
} = {}): SupabaseClient<Database> {
  const pointer = overrides.pointerResult ?? { data: null, error: { message: 'not found' } };
  const version = overrides.versionResult ?? { data: null, error: { message: 'not found' } };

  let fromCallIndex = 0;
  return {
    from: vi.fn().mockImplementation((_table: string) => {
      const isPointer = fromCallIndex === 0;
      fromCallIndex += 1;
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(isPointer ? pointer : version),
      };
    }),
    rpc: vi.fn().mockImplementation((name: string) => {
      const result = overrides.rpcResults?.[name];
      return Promise.resolve(result ?? { data: null, error: null });
    }),
  } as unknown as SupabaseClient<Database>;
}

const FRESH_ROW = {
  doc_type: 'terms',
  version: 3,
  effective_date: '2026-05-24T00:00:00.000Z',
  body_md: '# Terms',
  content_hash: 'hash-v3',
  severity: 'standard',
  change_summary: '- bullet',
  published_at: '2026-05-24T00:00:00.000Z',
};

describe('SupabaseLegalDocumentRepository.getCurrentContent', () => {
  let storage: AsyncKVStorage;
  let cache: LegalDocumentCache;

  beforeEach(() => {
    storage = makeMemStorage();
    cache = new LegalDocumentCache(storage);
  });

  it('returns network content and writes to cache when the cache is empty', async () => {
    const client = makeClient({
      pointerResult: { data: { current_version: 3 }, error: null },
      versionResult: { data: FRESH_ROW, error: null },
    });
    const repo = new SupabaseLegalDocumentRepository(client, cache);

    const result = await repo.getCurrentContent('terms');

    expect(result.version).toBe(3);
    expect(result.contentHash).toBe('hash-v3');
    const cached = await cache.readPointer('terms');
    expect(cached?.contentHash).toBe('hash-v3');
  });

  it('returns cached content on network failure (fall-open)', async () => {
    await cache.write({
      docType: 'terms',
      version: 2,
      effectiveDate: new Date('2026-05-01T00:00:00Z'),
      bodyMd: '# Old',
      contentHash: 'hash-v2',
      severity: 'minor',
      changeSummary: null,
      publishedAt: new Date('2026-05-01T00:00:00Z'),
    });

    const client = makeClient({
      pointerResult: { data: null, error: { message: 'offline' } },
    });
    const repo = new SupabaseLegalDocumentRepository(client, cache);

    const result = await repo.getCurrentContent('terms');
    expect(result.version).toBe(2);
  });

  it('throws when the cache is empty and the network fails', async () => {
    const client = makeClient({
      pointerResult: { data: null, error: { message: 'offline' } },
    });
    const repo = new SupabaseLegalDocumentRepository(client, cache);

    await expect(repo.getCurrentContent('terms')).rejects.toThrow();
  });

  it('writes a new cache entry when content_hash differs from cached version', async () => {
    await cache.write({
      docType: 'terms',
      version: 2,
      effectiveDate: new Date('2026-05-01T00:00:00Z'),
      bodyMd: '# Old',
      contentHash: 'hash-v2',
      severity: 'minor',
      changeSummary: null,
      publishedAt: new Date('2026-05-01T00:00:00Z'),
    });

    const client = makeClient({
      pointerResult: { data: { current_version: 3 }, error: null },
      versionResult: { data: FRESH_ROW, error: null },
    });
    const repo = new SupabaseLegalDocumentRepository(client, cache);

    const result = await repo.getCurrentContent('terms');
    expect(result.contentHash).toBe('hash-v3');

    const cached = await cache.readPointer('terms');
    expect(cached?.contentHash).toBe('hash-v3');
  });
});

describe('SupabaseLegalDocumentRepository.getPendingForCurrentUser', () => {
  it('maps RPC rows to LegalPendingItem domain shape', async () => {
    const client = makeClient({
      rpcResults: {
        needs_legal_reacknowledgement: {
          data: [
            {
              doc_type: 'terms',
              current_version: 2,
              current_effective_date: '2026-05-20T00:00:00.000Z',
              last_material_version: 2,
              last_material_severity: 'standard',
              last_accepted_version: 0,
              block_mode: 'banner',
            },
          ],
          error: null,
        },
      },
    });
    const repo = new SupabaseLegalDocumentRepository(
      client,
      new LegalDocumentCache(makeMemStorage()),
    );

    const result = await repo.getPendingForCurrentUser();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      docType: 'terms',
      currentVersion: 2,
      currentEffectiveDate: new Date('2026-05-20T00:00:00.000Z'),
      lastAcceptedVersion: 0,
      severity: 'standard',
      blockMode: 'banner',
    });
  });

  it('returns [] when the RPC returns null data', async () => {
    const client = makeClient({
      rpcResults: { needs_legal_reacknowledgement: { data: null, error: null } },
    });
    const repo = new SupabaseLegalDocumentRepository(
      client,
      new LegalDocumentCache(makeMemStorage()),
    );

    const result = await repo.getPendingForCurrentUser();
    expect(result).toEqual([]);
  });

  it('throws when the RPC returns an error', async () => {
    const client = makeClient({
      rpcResults: { needs_legal_reacknowledgement: { data: null, error: { message: 'rpc fail' } } },
    });
    const repo = new SupabaseLegalDocumentRepository(
      client,
      new LegalDocumentCache(makeMemStorage()),
    );

    await expect(repo.getPendingForCurrentUser()).rejects.toThrow();
  });
});

describe('SupabaseLegalDocumentRepository.acceptVersion', () => {
  it('calls accept_legal_document RPC and maps the response', async () => {
    const client = makeClient({
      rpcResults: {
        accept_legal_document: {
          data: { acceptance_id: 'uuid-1', accepted_at: '2026-05-24T12:00:00.000Z' },
          error: null,
        },
      },
    });
    const repo = new SupabaseLegalDocumentRepository(
      client,
      new LegalDocumentCache(makeMemStorage()),
    );

    const result = await repo.acceptVersion({
      docType: 'terms',
      version: 3,
      locale: 'he',
      userAgent: 'iOS 17',
    });

    expect(result).toEqual({
      acceptanceId: 'uuid-1',
      acceptedAt: new Date('2026-05-24T12:00:00.000Z'),
    });
    expect(client.rpc).toHaveBeenCalledWith('accept_legal_document', {
      p_doc_type: 'terms',
      p_version: 3,
      p_locale: 'he',
      p_user_agent: 'iOS 17',
    });
  });

  it('throws when the RPC returns an error', async () => {
    const client = makeClient({
      rpcResults: {
        accept_legal_document: {
          data: null,
          error: { message: 'accepted version 1 must be in [2, 2]' },
        },
      },
    });
    const repo = new SupabaseLegalDocumentRepository(
      client,
      new LegalDocumentCache(makeMemStorage()),
    );

    await expect(
      repo.acceptVersion({ docType: 'terms', version: 1, locale: 'he', userAgent: 'ua' }),
    ).rejects.toThrow(/accepted version/);
  });
});
