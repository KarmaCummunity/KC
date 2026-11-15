import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rankFrHits, resolveRef } from './spec.mjs';

const FILES = [
  'docs/spec/README.md',
  'docs/spec/04_product_structure.md',
  'docs/spec/07_cross_cutting_systems.md',
  'docs/spec/requirements/04_posts.md',
  'docs/spec/requirements/07_chat.md',
  'docs/spec/requirements/14_karma.md',
];

describe('spec resolveRef', () => {
  it('takes an exact path', () => {
    assert.equal(resolveRef('docs/spec/requirements/04_posts.md', FILES).match, 'docs/spec/requirements/04_posts.md');
  });

  it('takes a file name, with or without .md, and a unique word from it', () => {
    assert.equal(resolveRef('04_posts', FILES).match, 'docs/spec/requirements/04_posts.md');
    assert.equal(resolveRef('07_chat.md', FILES).match, 'docs/spec/requirements/07_chat.md');
    assert.equal(resolveRef('karma', FILES).match, 'docs/spec/requirements/14_karma.md');
  });

  it('refuses a number prefix that names two files and lists both', () => {
    const r = resolveRef('04', FILES);
    assert.equal(r.match, undefined);
    assert.deepEqual(r.candidates, ['docs/spec/04_product_structure.md', 'docs/spec/requirements/04_posts.md']);
  });

  it('resolves an FR-ID to the file that mentions it most', () => {
    const r = resolveRef('FR-POST-004', FILES, () => ['docs/spec/requirements/04_posts.md', 'docs/spec/requirements/06_feed_and_search.md']);
    assert.equal(r.match, 'docs/spec/requirements/04_posts.md');
  });

  it('resolves an FR-ID to the defining heading when mention counts are tied', () => {
    const hits = rankFrHits([
      { file: 'docs/spec/requirements/15_rides.md', count: 1, defines: false },
      { file: 'docs/spec/requirements/17_responsive_desktop.md', count: 1, defines: true },
    ]);
    const files = [...FILES, 'docs/spec/requirements/15_rides.md', 'docs/spec/requirements/17_responsive_desktop.md'];
    const r = resolveRef('FR-RESP-006', files, () => hits);
    assert.equal(r.match, 'docs/spec/requirements/17_responsive_desktop.md');
    assert.deepEqual(r.candidates[0], 'docs/spec/requirements/17_responsive_desktop.md');
  });

  it('uses mention counts only to break ties among non-defining files', () => {
    assert.deepEqual(
      rankFrHits([
        { file: 'docs/spec/requirements/a.md', count: 5, defines: false },
        { file: 'docs/spec/requirements/b.md', count: 1, defines: true },
        { file: 'docs/spec/requirements/c.md', count: 3, defines: false },
      ]),
      ['docs/spec/requirements/b.md', 'docs/spec/requirements/a.md', 'docs/spec/requirements/c.md'],
    );
  });

  it('reports no match for an unknown reference', () => {
    assert.deepEqual(resolveRef('nonsense', FILES), { match: undefined, candidates: [] });
    assert.deepEqual(resolveRef('FR-NOPE-001', FILES), { match: undefined, candidates: [] });
  });
});
