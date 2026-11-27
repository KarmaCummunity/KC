import { describe, expect, it } from 'vitest';
import { ObjectTooLargeError } from '../../../platform/storage/objectStore';
import { CopySourceError, createSupabaseStorageSource, type SourceFetch } from '../supabaseStorageSource';

const CONFIG = { url: 'https://project.supabase.test/', key: 'service-key' };

/** A source whose every request is answered by `answer`, and the requests it made. */
function sourceAnswering(answer: () => Response) {
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchFn: SourceFetch = (url, init) => {
    requests.push({ url, headers: init.headers as Record<string, string> });
    return Promise.resolve(answer());
  };
  return { source: createSupabaseStorageSource(CONFIG, fetchFn), requests };
}

describe('createSupabaseStorageSource', () => {
  it('reads a file through the project\'s storage API, with the key as project key and as caller', async () => {
    const { source, requests } = sourceAnswering(() => new Response(new Uint8Array([1, 2, 3])));

    const bytes = await source.read('chat-media', 'u1/c1/x.jpg', 100);

    expect(Array.from(bytes ?? [])).toEqual([1, 2, 3]);
    expect(requests).toEqual([{ url: 'https://project.supabase.test/storage/v1/object/chat-media/u1/c1/x.jpg', headers: { apikey: 'service-key', authorization: 'Bearer service-key' } }]);
  });

  it('escapes each part of a name and keeps its slashes', async () => {
    const { source, requests } = sourceAnswering(() => new Response(new Uint8Array([1])));

    await source.read('post-images', 'u1/my photo #1?.jpg', 100);

    expect(requests[0]?.url).toBe('https://project.supabase.test/storage/v1/object/post-images/u1/my%20photo%20%231%3F.jpg');
  });

  it.each([
    ['under status 400, as the service answers today', 400],
    ['under status 404', 404],
  ])('answers null for a file the source says it does not have: %s', async (_shape, status) => {
    const { source } = sourceAnswering(() => new Response('{"statusCode":"404","error":"not_found","message":"Object not found"}', { status }));

    expect(await source.read('avatars', 'u1/gone.jpg', 100)).toBeNull();
  });

  // The bodies are the service's own, recorded from a local Supabase stack (storage-api 1.54).
  it.each([
    ['a key it does not accept, which it answers as a missing bucket', () => new Response('{"statusCode":"404","error":"Bucket not found","message":"Bucket not found"}', { status: 400 }), 400],
    ['a malformed key', () => new Response('{"statusCode":"403","error":"Unauthorized","message":"Invalid Compact JWS"}', { status: 400 }), 400],
    ['a 404 that is not its own "no such file"', () => new Response('<html>not found</html>', { status: 404 }), 404],
    ['a request it could not parse', () => new Response('not json', { status: 400 }), 400],
    ['a failure of its own', () => new Response('', { status: 500 }), 500],
  ])('fails, and never reads as "no such file", when the source answers with %s', async (_what, answer, status) => {
    const failure = await sourceAnswering(answer).source.read('avatars', 'u1/a.jpg', 100).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CopySourceError);
    expect((failure as CopySourceError).status).toBe(status);
  });

  it('lists the buckets the key can see', async () => {
    const { source, requests } = sourceAnswering(() => Response.json([{ id: 'avatars', public: true }, { id: 'chat-media', public: false }]));

    expect(await source.readableBuckets()).toEqual(['avatars', 'chat-media']);
    expect(requests).toEqual([{ url: 'https://project.supabase.test/storage/v1/bucket', headers: { apikey: 'service-key', authorization: 'Bearer service-key' } }]);
  });

  it('fails when the service refuses to list its buckets', async () => {
    const { source } = sourceAnswering(() => new Response('{"statusCode":"403","error":"Unauthorized","message":"Invalid Compact JWS"}', { status: 400 }));

    await expect(source.readableBuckets()).rejects.toBeInstanceOf(CopySourceError);
  });

  it('refuses a file larger than the reader takes, from its announced size', async () => {
    const { source } = sourceAnswering(() => new Response(new Uint8Array(8), { headers: { 'content-length': '8' } }));

    await expect(source.read('avatars', 'u1/big.jpg', 7)).rejects.toBeInstanceOf(ObjectTooLargeError);
    expect(await source.read('avatars', 'u1/big.jpg', 8)).toHaveLength(8);
  });

  it('refuses a file larger than the reader takes when no size was announced', async () => {
    const unannounced = () => new Response(new ReadableStream({ start: (stream) => (stream.enqueue(new Uint8Array(8)), stream.close()) }));

    await expect(sourceAnswering(unannounced).source.read('avatars', 'u1/big.jpg', 7)).rejects.toBeInstanceOf(ObjectTooLargeError);
  });
});
