import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EdgeFnPostExtractionService } from '../EdgeFnPostExtractionService';

const request = { text: 'sofa for free', channel: 'share', sourcePlatform: 'facebook' } as const;

function service(result: { data: unknown; error: unknown }) {
  const invoke = vi.fn().mockResolvedValue(result);
  return { svc: new EdgeFnPostExtractionService({ functions: { invoke } } as unknown as SupabaseClient), invoke };
}

function rpcService(error: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error });
  return { svc: new EdgeFnPostExtractionService({ rpc } as unknown as SupabaseClient), rpc };
}

describe('EdgeFnPostExtractionService', () => {
  it('calls extract-external-post with the text, channel and platform and nothing else', async () => {
    const { svc, invoke } = service({ data: { routing: 'manual', reason: 'disabled', extraction: null }, error: null });
    await svc.extract(request);
    expect(invoke).toHaveBeenCalledWith('extract-external-post', {
      body: { text: 'sofa for free', channel: 'share', sourcePlatform: 'facebook' },
    });
  });

  it('parses the answer into a draft', async () => {
    const { svc } = service({ data: { importId: 'i1', routing: 'manual', reason: 'rate_limited', confidence: 0, extraction: null }, error: null });
    expect(await svc.extract(request)).toMatchObject({ importId: 'i1', routing: 'manual', reason: 'rate_limited' });
  });

  it('a body that is not a draft is the manual route', async () => {
    const { svc } = service({ data: 'oops', error: null });
    expect(await svc.extract(request)).toMatchObject({ routing: 'manual', reason: 'invalid_response' });
  });

  it.each([
    [{ data: null, error: { message: 'boom' } }],
    [{ data: { routing: 'ready' }, error: { message: 'http 500' } }],
    [{ data: null, error: null }],
    [{ data: undefined, error: null }],
  ])('no usable answer is null (%j)', async (result) => {
    expect(await service(result).svc.extract(request)).toBeNull();
  });

  describe('attachPost', () => {
    it('calls api_import_attach_post with the two ids and says it linked', async () => {
      const { svc, rpc } = rpcService(null);
      expect(await svc.attachPost('imp-1', 'post-1')).toBe(true);
      expect(rpc).toHaveBeenCalledWith('api_import_attach_post', { p_import_id: 'imp-1', p_post_id: 'post-1' });
    });

    it('a refusal or an error is false, never a throw', async () => {
      expect(await rpcService({ message: 'import_not_found', code: 'P0002' }).svc.attachPost('i', 'p')).toBe(false);
    });
  });

  // FR-IMPORT-010 AC4 — the edit-rate signal.
  describe('recordEdits', () => {
    it('calls api_import_record_edits with the import and the fields', async () => {
      const { svc, rpc } = rpcService(null);
      expect(await svc.recordEdits('imp-1', ['title', 'city'])).toBe(true);
      expect(rpc).toHaveBeenCalledWith('api_import_record_edits', { p_import_id: 'imp-1', p_edited_fields: ['title', 'city'] });
    });

    it('a refusal is false, never a throw', async () => {
      expect(await rpcService({ message: 'import_not_published', code: 'P0001' }).svc.recordEdits('i', [])).toBe(false);
    });
  });
});
