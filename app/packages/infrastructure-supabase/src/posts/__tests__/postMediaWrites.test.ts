import { describe, expect, it } from 'vitest';
import { callsTo, createFakeClient, type FakeCall } from '../../__tests__/fakeBaselineClient';
import { replacePostMedia, writePostMedia } from '../postMediaWrites';
import { ok } from './cardFixtures';

const asset = (n: number) => ({ path: `u1/b/${n}.jpg`, mimeType: 'image/jpeg', sizeBytes: 100 + n });

describe('writePostMedia', () => {
  it('records the photos in order as rows of the owner in the post-images bucket', async () => {
    const { client, calls } = createFakeClient({ tables: { post_media: ok(null) } });

    await writePostMedia(client, 'p1', 'u1', [asset(0), asset(1)]);

    expect(callsTo(calls, 'post_media')[0]?.payload).toEqual([
      { post_id: 'p1', owner_id: 'u1', kind: 'image', storage_bucket: 'post-images', storage_key: 'u1/b/0.jpg', ordinal: 0, mime_type: 'image/jpeg', size_bytes: 100 },
      { post_id: 'p1', owner_id: 'u1', kind: 'image', storage_bucket: 'post-images', storage_key: 'u1/b/1.jpg', ordinal: 1, mime_type: 'image/jpeg', size_bytes: 101 },
    ]);
  });

  it('writes nothing for no photos', async () => {
    const { client, calls } = createFakeClient();
    await writePostMedia(client, 'p1', 'u1', []);
    expect(calls).toHaveLength(0);
  });
});

describe('replacePostMedia', () => {
  const existing = [
    { id: 'row-0', storage_key: 'u1/b/0.jpg', ordinal: 0 },
    { id: 'row-1', storage_key: 'u1/b/1.jpg', ordinal: 1 },
  ];
  const setup = () =>
    createFakeClient({ tables: { post_media: (call: FakeCall) => ok(call.kind === 'select' ? existing : null) } });

  it('keeps the rows whose file and position are unchanged, deletes the rest and inserts the new', async () => {
    const { client, calls } = setup();

    await replacePostMedia(client, 'p1', 'u1', [asset(0), asset(2)]);

    const remove = callsTo(calls, 'post_media').find((call) => call.kind === 'delete');
    const insert = callsTo(calls, 'post_media').find((call) => call.kind === 'insert');
    expect(remove?.filters).toContainEqual(['in', 'id', ['row-1']]);
    expect(insert?.payload).toEqual([expect.objectContaining({ storage_key: 'u1/b/2.jpg', ordinal: 1 })]);
  });

  it('does not touch an unchanged gallery', async () => {
    const { client, calls } = setup();

    await replacePostMedia(client, 'p1', 'u1', [asset(0), asset(1)]);

    expect(callsTo(calls, 'post_media').map((call) => call.kind)).toEqual(['select']);
  });

  it('deletes everything when the photos were removed', async () => {
    const { client, calls } = setup();

    await replacePostMedia(client, 'p1', 'u1', []);

    const remove = callsTo(calls, 'post_media').find((call) => call.kind === 'delete');
    expect(remove?.filters).toContainEqual(['in', 'id', ['row-0', 'row-1']]);
  });
});
