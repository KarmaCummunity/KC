import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LegalConsentError } from '@kc/application';
import { BackendUnavailableError } from '@kc/domain';
import type { Database } from '../database.types';
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
  rpcResults?: Record<string, { data: unknown; error: { code?: string; message: string } | null }>;
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

const bootstrap = (documents: unknown) => ({
  data: { user_id: 'u1', account: { status: 'active' }, private_profile: {}, legal: { documents } },
  error: null,
});

describe('SupabaseLegalDocumentRepository.getPendingForCurrentUser', () => {
  it('maps the legal.documents of bootstrap_session to LegalPendingItem domain shape', async () => {
    const client = makeClient({
      rpcResults: {
        bootstrap_session: bootstrap([
          {
            doc_type: 'terms',
            current_version: 2,
            current_effective_date: '2026-05-20T00:00:00.000Z',
            last_material_version: 2,
            last_material_severity: 'standard',
            last_accepted_version: 0,
            block_mode: 'banner',
          },
        ]),
      },
    });
    const repo = new SupabaseLegalDocumentRepository(client, new LegalDocumentCache(makeMemStorage()));

    const result = await repo.getPendingForCurrentUser();

    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(vi.mocked(client.rpc).mock.calls[0]?.[0]).toBe('bootstrap_session');
    expect(result).toEqual([
      {
        docType: 'terms',
        currentVersion: 2,
        currentEffectiveDate: new Date('2026-05-20T00:00:00.000Z'),
        lastAcceptedVersion: 0,
        severity: 'standard',
        blockMode: 'banner',
      },
    ]);
  });

  it('reads a document without a material severity as standard', async () => {
    const client = makeClient({
      rpcResults: {
        bootstrap_session: bootstrap([
          { doc_type: 'privacy', current_version: 1, current_effective_date: '2026-05-20T00:00:00Z', block_mode: 'modal' },
        ]),
      },
    });
    const repo = new SupabaseLegalDocumentRepository(client, new LegalDocumentCache(makeMemStorage()));

    expect((await repo.getPendingForCurrentUser())[0]).toMatchObject({ severity: 'standard', blockMode: 'modal' });
  });

  it('returns [] when nothing is pending', async () => {
    const client = makeClient({ rpcResults: { bootstrap_session: bootstrap([]) } });
    const repo = new SupabaseLegalDocumentRepository(client, new LegalDocumentCache(makeMemStorage()));

    expect(await repo.getPendingForCurrentUser()).toEqual([]);
  });

  it('throws when the RPC returns an error', async () => {
    const client = makeClient({
      rpcResults: { bootstrap_session: { data: null, error: { message: 'rpc fail' } } },
    });
    const repo = new SupabaseLegalDocumentRepository(client, new LegalDocumentCache(makeMemStorage()));

    await expect(repo.getPendingForCurrentUser()).rejects.toThrow('rpc fail');
  });

  it('reports a missing bootstrap_session as BackendUnavailableError', async () => {
    const client = makeClient({
      rpcResults: { bootstrap_session: { data: null, error: { code: 'PGRST202', message: 'not found' } } },
    });
    const repo = new SupabaseLegalDocumentRepository(client, new LegalDocumentCache(makeMemStorage()));

    await expect(repo.getPendingForCurrentUser()).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('SupabaseLegalDocumentRepository.acceptVersion', () => {
  const input = { docType: 'terms', version: 3, locale: 'he', userAgent: 'iOS 17' } as const;
  const repoFor = (client: SupabaseClient<Database>) =>
    new SupabaseLegalDocumentRepository(client, new LegalDocumentCache(makeMemStorage()));

  it('calls accept_legal_document with the named arguments and maps the response', async () => {
    const client = makeClient({
      rpcResults: {
        accept_legal_document: {
          data: { acceptance_id: 'uuid-1', accepted_at: '2026-05-24T12:00:00.000Z' },
          error: null,
        },
      },
    });

    const result = await repoFor(client).acceptVersion(input);

    expect(result).toEqual({ acceptanceId: 'uuid-1', acceptedAt: new Date('2026-05-24T12:00:00.000Z') });
    expect(client.rpc).toHaveBeenCalledWith('accept_legal_document', {
      p_doc_type: 'terms',
      p_version: 3,
      p_locale: 'he',
      p_user_agent: 'iOS 17',
    });
  });

  it.each([
    ['legal_version_out_of_range', 'version_out_of_range'],
    ['unknown_legal_document', 'unknown_document'],
  ])('maps the refusal %s to LegalConsentError(%s)', async (reason, code) => {
    const client = makeClient({
      rpcResults: { accept_legal_document: { data: null, error: { code: 'P0001', message: reason } } },
    });

    const error = await repoFor(client).acceptVersion(input).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LegalConsentError);
    expect(error).toMatchObject({ code });
  });

  it('leaves a signed-out refusal as the rule error', async () => {
    const client = makeClient({
      rpcResults: { accept_legal_document: { data: null, error: { code: '42501', message: 'unauthenticated' } } },
    });

    await expect(repoFor(client).acceptVersion(input)).rejects.toMatchObject({ reason: 'unauthenticated' });
  });

  it('throws on any other error', async () => {
    const client = makeClient({
      rpcResults: { accept_legal_document: { data: null, error: { message: 'connection reset' } } },
    });

    await expect(repoFor(client).acceptVersion(input)).rejects.toThrow('connection reset');
  });
});
