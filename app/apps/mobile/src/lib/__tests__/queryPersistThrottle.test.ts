// The persisted query cache is written at most once per QUERY_PERSIST_THROTTLE_MS: each write
// serializes the whole cache on the JS thread, so the gap bounds that cost while scrolling.
import { describe, expect, it, vi } from 'vitest';

const persisterOptions = vi.hoisted(() => [] as { throttleTime?: number }[]);
vi.mock('@tanstack/query-async-storage-persister', () => ({
  createAsyncStoragePersister: (options: { throttleTime?: number }) => {
    persisterOptions.push(options);
    return { persistClient: vi.fn(), restoreClient: vi.fn(), removeClient: vi.fn() };
  },
}));

import { QUERY_PERSIST_THROTTLE_MS } from '../queryPersist';

describe('query cache persistence throttle', () => {
  it('hands the throttle to the persister', () => {
    expect(persisterOptions).toHaveLength(1);
    expect(persisterOptions[0]?.throttleTime).toBe(QUERY_PERSIST_THROTTLE_MS);
  });

  it('writes no more often than every few seconds', () => {
    expect(QUERY_PERSIST_THROTTLE_MS).toBeGreaterThanOrEqual(3000);
  });
});
