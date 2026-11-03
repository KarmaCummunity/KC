import { describe, expect, it } from 'vitest';
import { rideSummaryFromDetails } from '../marketplacePaging';

describe('rideSummaryFromDetails', () => {
  it('maps offer details', () => {
    expect(rideSummaryFromDetails({ origin_label: 'תל אביב', dest_label: 'חיפה', departs_at: '2026-11-01T08:00:00Z', seats_available: 3 }))
      .toEqual({ originLabel: 'תל אביב', destLabel: 'חיפה', departsAt: '2026-11-01T08:00:00Z', seats: 3 });
  });
  it('falls back to passengers and nulls', () => {
    expect(rideSummaryFromDetails({ passengers: 2 })).toEqual({ originLabel: null, destLabel: null, departsAt: null, seats: 2 });
    expect(rideSummaryFromDetails(null)).toBeNull();
  });
});

import { attachCardExtras } from '../marketplacePaging';
import type { MarketplaceBrowseRow } from '@kc/domain';

const row = (id: string, worldSlug: string): MarketplaceBrowseRow => ({
  listingId: id, worldSlug, kindSlug: 'k', direction: 'give', title: 't', summary: null,
  urgencyLevel: 0, availabilityStatus: 'open', cityId: null, distanceKm: null,
});
/** A client whose one `listings` read resolves to `result` (or rejects with it), counting reads. */
function client(result: unknown) {
  const reads: unknown[] = [];
  const c = {
    from: () => ({
      select: () => ({
        in: (_col: string, ids: unknown) => {
          reads.push(ids);
          return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
        },
      }),
    }),
  } as never;
  return { c, reads };
}

describe('attachCardExtras', () => {
  it('makes no read for an empty page', async () => {
    const { c, reads } = client({ data: [], error: null });
    const rows: MarketplaceBrowseRow[] = [];
    expect(await attachCardExtras(c, rows)).toBe(rows);
    expect(reads).toEqual([]);
  });

  it('attaches every row its publisher, and a ride its route, in one read', async () => {
    const { c, reads } = client({
      data: [
        { listing_id: 'r', details: { origin_label: 'A', dest_label: 'B', seats_available: 2 }, publisher: { display_name: 'Dana', avatar_url: null } },
        { listing_id: 'x', details: { origin_label: 'ignored' }, publisher: [{ display_name: 'Noa', avatar_url: 'u' }] },
      ],
      error: null,
    });
    const out = await attachCardExtras(c, [row('r', 'rides'), row('x', 'food'), row('gone', 'items')]);
    expect(reads).toEqual([['r', 'x', 'gone']]);
    expect(out[0]?.ride).toEqual({ originLabel: 'A', destLabel: 'B', departsAt: null, seats: 2 });
    expect(out[0]?.publisher).toEqual({ displayName: 'Dana', avatarUrl: null });
    expect(out[1]?.ride).toBeUndefined();
    expect(out[1]?.publisher).toEqual({ displayName: 'Noa', avatarUrl: 'u' });
    expect(out[2]).toEqual(row('gone', 'items'));
  });

  it('returns rows unchanged on error or throw', async () => {
    const rows = [row('r', 'rides')];
    expect(await attachCardExtras(client({ data: null, error: { message: 'x' } }).c, rows)).toBe(rows);
    expect(await attachCardExtras(client(new Error('boom')).c, rows)).toBe(rows);
    expect(await attachCardExtras(client({ data: null, error: null }).c, rows)).toBe(rows);
  });
});
