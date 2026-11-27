import { describe, expect, it } from 'vitest';
import type { IdentityDatabase } from '../../database/identityDatabase';
import type { CallerIdentity } from '../../identity/callerIdentity';
import type { StorageAuthorizer } from '../storageAuthorizer';
import { StorageService } from '../storageService';

const CALLER: CallerIdentity = { userId: 'u1', claims: { sub: 'u1', role: 'authenticated' } };

describe('StorageService without an object store', () => {
  /** Collaborators that fail the test if they are reached. */
  const untouched = new Proxy({}, { get: () => () => { throw new Error('must not be reached'); } });
  const service = new StorageService(null, untouched as StorageAuthorizer, untouched as IdentityDatabase);

  it('answers 503 not_configured to every request and asks nothing of the database', async () => {
    const answers = await Promise.all([
      service.grantUpload(CALLER, { bucket: 'avatars', name: 'u1/a.jpg', contentType: 'image/jpeg', size: 1 }),
      service.completeUpload(CALLER, { bucket: 'avatars', name: 'u1/a.jpg' }),
      service.signedReadUrl(CALLER, { bucket: 'chat-media', name: 'u1/c/a.jpg', expiresIn: 60 }),
      service.deleteObjects(CALLER, { bucket: 'avatars', names: ['u1/a.jpg'] }),
    ]);

    expect(answers).toEqual(Array(4).fill({ status: 503, body: { error: 'not_configured' } }));
  });
});
