import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const modules=['055_dispatch_scoped.sql','056_dispatch_jobs.sql','057_dispatch_settle.sql','058_dispatch_invocation.sql','065_dispatch_retention.sql'];
test('dispatch migration is the exact canonical modules, not a second drifting implementation',()=>{
  const expected='-- Dispatch recovery: generated concatenation of canonical dispatch modules.\n'+
    modules.map(f=>readFileSync(new URL('../supabase/schemas/95_platform/'+f,import.meta.url),'utf8')).join('');
  assert.equal(readFileSync(new URL('../supabase/migrations/0084_edge_invocation_apikey.sql',import.meta.url),'utf8'),expected);
});
