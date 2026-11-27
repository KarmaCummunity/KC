import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { Storage } from '@google-cloud/storage';
import { GcsObjectStore } from '../gcsObjectStore';
import type { ObjectStoreLeg } from './objectStoreContract';

/** The KC buckets the contract writes to. */
const CONTRACT_BUCKETS = ['avatars', 'post-images', 'chat-media'] as const;
/** Where public files would be served from; nothing in these suites fetches it. */
export const GCS_TEST_MEDIA_URL = 'https://media.kc.test';

/** Every name the contract and these suites write starts with this, which is how a real bucket is cleaned up after a run. */
const TEST_NAME_PREFIX = 'contract-';

/** A Cloud Storage leg, with what its own suite needs beside the contract. */
export interface GcsTestLeg extends ObjectStoreLeg {
  readonly store: GcsObjectStore;
  readonly storage: Storage;
  readonly bucketPrefix: string;
}

/**
 * A client of the Cloud Storage emulator. The key is made here and signs
 * nothing a real project would accept: the emulator needs one only so that
 * the SDK can build signed addresses. With a custom endpoint the SDK sends no
 * credential and contacts no Google service.
 */
function emulatorClient(endpoint: string): Storage {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return new Storage({
    apiEndpoint: endpoint,
    projectId: 'kc-test',
    credentials: { client_email: 'kc-api@kc-test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() },
    // A failure is the test's answer, at once.
    retryOptions: { autoRetry: false },
  });
}

/**
 * A `GcsObjectStore` on the emulator at `endpoint`, with its own set of
 * buckets (a prefix no other run uses), removed with their objects on close.
 */
export async function openEmulatorLeg(endpoint: string): Promise<GcsTestLeg> {
  const storage = emulatorClient(endpoint);
  const bucketPrefix = `kc-test-${randomUUID().slice(0, 8)}-`;
  for (const bucket of CONTRACT_BUCKETS) await storage.createBucket(bucketPrefix + bucket);
  return {
    store: new GcsObjectStore({ storage, bucketPrefix, mediaBaseUrl: GCS_TEST_MEDIA_URL }),
    storage,
    bucketPrefix,
    publicBaseUrl: GCS_TEST_MEDIA_URL,
    close: async () => {
      for (const bucket of CONTRACT_BUCKETS) {
        await storage.bucket(bucketPrefix + bucket).deleteFiles({ force: true });
        await storage.bucket(bucketPrefix + bucket).delete();
      }
    },
  };
}

/**
 * A `GcsObjectStore` on a real project, with the run's own Google
 * credentials. The buckets `<bucketPrefix>avatars`, `…post-images` and
 * `…chat-media` must exist; closing removes what the run wrote and nothing
 * else.
 */
export function openProjectLeg(bucketPrefix: string): Promise<GcsTestLeg> {
  const storage = new Storage({ retryOptions: { autoRetry: false } });
  return Promise.resolve({
    store: new GcsObjectStore({ storage, bucketPrefix, mediaBaseUrl: GCS_TEST_MEDIA_URL }),
    storage,
    bucketPrefix,
    publicBaseUrl: GCS_TEST_MEDIA_URL,
    close: async () => {
      for (const bucket of CONTRACT_BUCKETS) await storage.bucket(bucketPrefix + bucket).deleteFiles({ prefix: TEST_NAME_PREFIX, force: true });
    },
  });
}
