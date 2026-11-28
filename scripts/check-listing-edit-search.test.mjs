import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
test('the actual non-items editor uses the mounted-search save callback', () => {
  const route = read('app/apps/mobile/app/edit-listing/[id].tsx');
  assert.match(route, /const onSaved = useListingEditSaved\(id, listingId\)/);
  assert.match(route, /onSaved=\{onSaved\}/);
  const hook = read('app/apps/mobile/src/hooks/useListingEditSaved.ts');
  assert.match(hook, /\['universalSearch'\]/);
  assert.ok(hook.indexOf('await Promise.all') < hook.indexOf('router.back()'));
  assert.match(read('app/apps/mobile/src/hooks/useListingCreateForm.ts'), /await onSaved\?\.\(\)/);
});
