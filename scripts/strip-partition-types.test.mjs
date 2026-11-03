import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripPartitionTypes } from './strip-partition-types.mjs';

// Minimal slice of `supabase gen types` output: a parent table, two monthly
// children and a neighbour whose name only looks date-like.
const entry = (name) => [
  `      ${name}: {`,
  '        Row: {',
  '          post_id: string',
  '        }',
  '        Relationships: []',
  '      }',
];
const source = [
  '    Tables: {',
  ...entry('feed_impressions'),
  ...entry('feed_impressions_y2026m10'),
  ...entry('feed_impressions_y2026m11'),
  ...entry('feed_mute_filters'),
  '    }',
].join('\n');

test('drops monthly partition children and keeps every other table', () => {
  const expected = ['    Tables: {', ...entry('feed_impressions'), ...entry('feed_mute_filters'), '    }'].join('\n');
  assert.equal(stripPartitionTypes(source), expected);
});

test('output does not depend on which months exist', () => {
  const nextMonth = source.replaceAll('y2026m11', 'y2026m12').replaceAll('y2026m10', 'y2026m11');
  assert.equal(stripPartitionTypes(nextMonth), stripPartitionTypes(source));
});

test('keeps names that are not a valid yYYYYmMM suffix', () => {
  const lookalikes = [...entry('stats_y2026m13'), ...entry('stats_y2026m1'), ...entry('y2026m11_archive')].join('\n');
  assert.equal(stripPartitionTypes(lookalikes), lookalikes);
});

test('fails loudly when a partition entry is never closed', () => {
  assert.throws(() => stripPartitionTypes(entry('feed_impressions_y2026m10').slice(0, -1).join('\n')), /never closed/);
});
