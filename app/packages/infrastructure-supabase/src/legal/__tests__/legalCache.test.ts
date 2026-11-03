import { describe, expect, it } from 'vitest';
import type { LegalDocumentContent } from '@kc/domain';
import { LegalDocumentCache, type AsyncKVStorage } from '../legalCache';

function makeMemStorage(initial: Record<string, string> = {}): AsyncKVStorage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v);
    },
    removeItem: async (k) => {
      map.delete(k);
    },
  };
}

const SAMPLE_CONTENT: LegalDocumentContent = {
  docType: 'terms',
  version: 2,
  effectiveDate: new Date('2026-05-01T00:00:00.000Z'),
  bodyMd: '# Terms of Service',
  contentHash: 'hash_v2',
  severity: 'standard',
  changeSummary: 'Updated terms',
  publishedAt: new Date('2026-05-01T00:00:00.000Z'),
};

describe('LegalDocumentCache', () => {
  describe('write & read', () => {
    it('writes content and reads it back by docType, version, and contentHash', async () => {
      const storage = makeMemStorage();
      const cache = new LegalDocumentCache(storage);

      await cache.write(SAMPLE_CONTENT);
      const readBack = await cache.read('terms', 2, 'hash_v2');

      expect(readBack).toEqual(SAMPLE_CONTENT);
    });

    it('returns null on cache miss', async () => {
      const storage = makeMemStorage();
      const cache = new LegalDocumentCache(storage);

      const result = await cache.read('terms', 99, 'missing_hash');
      expect(result).toBeNull();
    });

    it('returns null when cached JSON is corrupted', async () => {
      const storage = makeMemStorage({
        'legal:terms:v2:bad_hash': '{ not-valid-json }',
      });
      const cache = new LegalDocumentCache(storage);

      const result = await cache.read('terms', 2, 'bad_hash');
      expect(result).toBeNull();
    });
  });

  describe('readPointer', () => {
    it('returns null when pointer key does not exist', async () => {
      const storage = makeMemStorage();
      const cache = new LegalDocumentCache(storage);

      const result = await cache.readPointer('privacy');
      expect(result).toBeNull();
    });

    it('returns null when pointer exists but pointed content is missing', async () => {
      const storage = makeMemStorage({
        'legal:privacy:pointer': 'legal:privacy:v1:hash_1',
      });
      const cache = new LegalDocumentCache(storage);

      const result = await cache.readPointer('privacy');
      expect(result).toBeNull();
    });

    it('returns null when pointed content is corrupted JSON', async () => {
      const storage = makeMemStorage({
        'legal:terms:pointer': 'legal:terms:v1:corrupt',
        'legal:terms:v1:corrupt': 'invalid-json',
      });
      const cache = new LegalDocumentCache(storage);

      const result = await cache.readPointer('terms');
      expect(result).toBeNull();
    });

    it('reads current content through pointer', async () => {
      const storage = makeMemStorage();
      const cache = new LegalDocumentCache(storage);

      await cache.write(SAMPLE_CONTENT);
      const result = await cache.readPointer('terms');

      expect(result).toEqual(SAMPLE_CONTENT);
    });
  });
});
