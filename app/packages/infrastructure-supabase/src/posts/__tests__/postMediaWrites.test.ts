import { describe, expect, it } from 'vitest';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { replacePostMedia, writePostMedia } from '../postMediaWrites';
import { fail, ok } from './cardFixtures';

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
  it('hands the whole gallery, in order, to replace_post_media', async () => {
    const { client, calls } = createFakeClient({ rpc: { replace_post_media: ok(null) } });

    await replacePostMedia(client, 'p1', [asset(2), asset(0)]);

    expect(calls).toHaveLength(1);
    expect(callsTo(calls, 'replace_post_media')[0]?.args).toEqual({
      p_post_id: 'p1',
      p_media: [
        { storage_key: 'u1/b/2.jpg', mime_type: 'image/jpeg', size_bytes: 102 },
        { storage_key: 'u1/b/0.jpg', mime_type: 'image/jpeg', size_bytes: 100 },
      ],
    });
  });

  it('sends an empty list when every photo was removed', async () => {
    const { client, calls } = createFakeClient({ rpc: { replace_post_media: ok(null) } });

    await replacePostMedia(client, 'p1', []);

    expect(callsTo(calls, 'replace_post_media')[0]?.args).toEqual({ p_post_id: 'p1', p_media: [] });
  });

  it('never deletes or inserts photo rows from the device', async () => {
    // A device delete of the last photo of a live offer is refused by the server (D132), so the
    // edit must not go through the table (KC#2118).
    const { client, calls } = createFakeClient({ rpc: { replace_post_media: ok(null) } });

    await replacePostMedia(client, 'p1', [asset(1)]);

    expect(callsTo(calls, 'post_media')).toHaveLength(0);
  });

  it('passes the server refusal on', async () => {
    const { client } = createFakeClient({ rpc: { replace_post_media: fail('P0001', 'offer_photo_required') } });
    await expect(replacePostMedia(client, 'p1', [])).rejects.toMatchObject({ reason: 'offer_photo_required' });
  });
});
