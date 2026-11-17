import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EdgeFnPostExtractionService } from '../EdgeFnPostExtractionService';

const request = { text: 'sofa for free', channel: 'share', sourcePlatform: 'facebook' } as const;

function service(result: { data: unknown; error: unknown }) {
  const invoke = vi.fn().mockResolvedValue(result);
  return { svc: new EdgeFnPostExtractionService({ functions: { invoke } } as unknown as SupabaseClient), invoke };
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
});
