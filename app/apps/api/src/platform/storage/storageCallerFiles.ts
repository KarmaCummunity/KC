import { Inject, Injectable } from '@nestjs/common';
import type { CallerIdentity } from '../identity/callerIdentity';
import type { CallerFiles } from '../ports/callerFiles';
import type { InProcessBucket, InProcessStorage } from '../postgrest/sqlBackedClient';
import { UnsafeObjectPathError } from './localObjectStore';
import { OBJECT_STORE, type ObjectStore } from './objectStore';
import { isSafeObjectName } from './storageAuthorizer';
import { StorageService } from './storageService';

/**
 * The hosted adapters' file storage (ADR-012 section 5): what an adapter
 * does on `client.storage` is done on this server's own store, as the member
 * the call is for. An upload passes the same policy and bucket rules as a
 * member's own upload, and lands in the index the same way.
 */
@Injectable()
export class StorageCallerFiles implements CallerFiles {
  constructor(
    @Inject(OBJECT_STORE) private readonly store: ObjectStore | null,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  get available(): boolean {
    return this.store !== null;
  }

  forCaller(caller: CallerIdentity | null): InProcessStorage | null {
    const store = this.store;
    if (!store) return null;
    return { from: (bucket) => this.bucketFor(store, caller, bucket) };
  }

  private bucketFor(store: ObjectStore, caller: CallerIdentity | null, bucket: string): InProcessBucket {
    return {
      getPublicUrl: (path) => {
        // The adapter fetches this address from the server: a path that climbs must never become one.
        if (!isSafeObjectName(path)) throw new UnsafeObjectPathError();
        return { data: { publicUrl: store.publicUrl(bucket, path) } };
      },
      upload: async (path, body, options = {}) => {
        // Replacing a file is not something KC's store does (ADR-012 section 3), and no adapter asks for it.
        if (options.upsert) return { data: null, error: { message: 'upsert_not_supported' } };
        const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
        const answer = await this.storage.storeBytes(caller, { bucket, name: path, bytes, contentType: options.contentType ?? 'application/octet-stream' });
        if (answer.status === 200) return { data: { path }, error: null };
        return { data: null, error: { message: (answer.body as { error: string }).error } };
      },
    };
  }
}
