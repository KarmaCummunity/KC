import type { StorageConfig } from '../config/apiConfig';
import { GcsObjectStore } from './gcsObjectStore';
import { LocalObjectStore } from './localObjectStore';
import type { ObjectStore } from './objectStore';

/**
 * The object store the configuration names (ADR-012 section 1): Cloud Storage
 * for a deployed API, a local directory for development and tests, or none,
 * in which case the storage routes answer `503 not_configured`.
 * @param localSigningSecret Key of the local store's grants; unused by the cloud store, whose addresses the cloud signs.
 */
export async function createObjectStore(config: StorageConfig, localSigningSecret: string): Promise<ObjectStore | null> {
  const { localDirectory, publicUrl, cloud } = config;
  if (cloud) {
    // Loaded only where a cloud store is configured, so no other process pays for the SDK at start.
    const { Storage } = await import('@google-cloud/storage');
    // No arguments: the client takes the identity of the service it runs as. There is no key file.
    return new GcsObjectStore({ storage: new Storage(), bucketPrefix: cloud.bucketPrefix, mediaBaseUrl: cloud.mediaUrl });
  }
  return localDirectory && publicUrl ? new LocalObjectStore({ directory: localDirectory, baseUrl: publicUrl, signingSecret: localSigningSecret }) : null;
}
