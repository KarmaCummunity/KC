import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findConflictBlocks, scanFiles } from './check-conflict-markers.mjs';

const CONFLICT = ['intro', '<<<<<<< HEAD', 'ours', '=======', 'theirs', '>>>>>>> origin/dev', 'outro'].join('\n');

test('finds a complete conflict block and reports its opening line', () => {
  assert.deepEqual(findConflictBlocks(CONFLICT), [2]);
});

test('finds an empty-sided block like the one committed on 2026-11-03', () => {
  assert.deepEqual(findConflictBlocks('<<<<<<< HEAD\n=======\n>>>>>>> origin/dev\n| TD-259 |'), [1]);
});

test('finds every block in a file, with CRLF line endings too', () => {
  const text = `${CONFLICT}\n${CONFLICT}`.replaceAll('\n', '\r\n');
  assert.deepEqual(findConflictBlocks(text), [2, 9]);
});

test('ignores a Markdown setext underline and stray marker-like lines', () => {
  assert.deepEqual(findConflictBlocks('Title\n=======\n\ntext'), []);
  assert.deepEqual(findConflictBlocks('<<<<<<< HEAD only, never closed\n======='), []);
  assert.deepEqual(findConflictBlocks('>>>>>>> a closing marker alone'), []);
  assert.deepEqual(findConflictBlocks('<<<<<<<< eight characters\n=======\n>>>>>>>> eight'), []);
});

test('scanFiles reports path:line, skips binary and unreadable files', () => {
  const files = {
    'docs/a.md': Buffer.from(CONFLICT),
    'docs/clean.md': Buffer.from('fine'),
    'img.png': Buffer.concat([Buffer.from([0x89, 0x50, 0x00]), Buffer.from(CONFLICT)]),
  };
  const read = (path) => {
    if (!(path in files)) throw new Error('ENOENT');
    return files[path];
  };
  assert.deepEqual(scanFiles([...Object.keys(files), 'deleted.md'], read), ['docs/a.md:2']);
});
