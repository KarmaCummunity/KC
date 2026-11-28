import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SignedUpload } from '../objectStore';
import { describeObjectStoreCacheControl, describeObjectStoreContract, describeObjectStorePaging } from './objectStoreContract';
import { type GcsTestLeg, openProjectLeg } from './gcsTestLeg';

// `GcsObjectStore` against a real Cloud Storage project: the whole contract,
// and what only the service itself enforces, which its emulator accepts
// without checking. Collected only when KC_API_TEST_GCS_BUCKET_PREFIX is set
// (vitest.config.ts); run before the first deploy of an environment and after
// an upgrade of the SDK:
//
//   KC_API_TEST_GCS_BUCKET_PREFIX=kc-dev- pnpm --filter @kc/api exec vitest run src/platform/storage
//
// The run needs Google credentials that may write to the three buckets and
// sign as the service account (README, "File storage").

const BUCKET_PREFIX = process.env.KC_API_TEST_GCS_BUCKET_PREFIX as string;
const openLeg = () => openProjectLeg(BUCKET_PREFIX);
const JPEG_GRANT = { contentType: 'image/jpeg', maxBytes: 8, cacheControl: 'public, max-age=60' };

describeObjectStoreContract('Cloud Storage (project)', openLeg);
describeObjectStorePaging('Cloud Storage (project)', openLeg);
describeObjectStoreCacheControl('Cloud Storage (project)', openLeg);

describe('GcsObjectStore (project): what the signed address enforces', () => {
  let leg: GcsTestLeg;

  beforeAll(async () => {
    leg = await openLeg();
  });

  afterAll(async () => {
    await leg.close();
  });

  const freshName = () => `contract-${randomUUID()}/upload.jpg`;
  const grantFor = (name: string) => leg.store.signedUploadUrl({ bucket: 'avatars', name, ...JPEG_GRANT }, 120);
  const send = async (upload: SignedUpload, body: Uint8Array<ArrayBuffer>, headers: Readonly<Record<string, string>> = upload.headers) =>
    (await fetch(upload.url, { method: upload.method, headers, body })).status;

  it('stores an upload that is what was granted, with its type and cache rule', async () => {
    const name = freshName();

    expect(await send(await grantFor(name), new Uint8Array([1, 2, 3]))).toBe(200);

    expect(await leg.store.head('avatars', name)).toEqual({ size: 3, contentType: 'image/jpeg', cacheControl: 'public, max-age=60' });
  });

  it('refuses a second upload to a name that is taken, and the first bytes stay', async () => {
    const name = freshName();
    await send(await grantFor(name), new Uint8Array([1]));

    expect(await send(await grantFor(name), new Uint8Array([9, 9]))).toBeGreaterThanOrEqual(400);

    expect(await leg.store.head('avatars', name)).toMatchObject({ size: 1 });
  });

  it('refuses a body larger than the grant allows, and stores nothing', async () => {
    const name = freshName();

    expect(await send(await grantFor(name), new Uint8Array(JPEG_GRANT.maxBytes + 1))).toBeGreaterThanOrEqual(400);

    expect(await leg.store.head('avatars', name)).toBeNull();
  });

  it('refuses another content type than the granted one, and stores nothing', async () => {
    const name = freshName();
    const upload = await grantFor(name);

    expect(await send(upload, new Uint8Array([1]), { ...upload.headers, 'content-type': 'text/html' })).toBeGreaterThanOrEqual(400);

    expect(await leg.store.head('avatars', name)).toBeNull();
  });

  it('refuses an upload that leaves out a signed condition, and stores nothing', async () => {
    const name = freshName();
    const upload = await grantFor(name);

    expect(await send(upload, new Uint8Array([1]), { 'content-type': 'image/jpeg' })).toBeGreaterThanOrEqual(400);

    expect(await leg.store.head('avatars', name)).toBeNull();
  });
});
