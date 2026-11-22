import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const modules=['055_dispatch_scoped.sql','056_dispatch_jobs.sql','057_dispatch_settle.sql','058_dispatch_invocation.sql','065_dispatch_retention.sql'];
test('dispatch migration is the exact canonical modules, before and after merge-time numbering',()=>{
  const expected='-- Dispatch recovery: generated concatenation of canonical dispatch modules.\n'+
    modules.map(f=>readFileSync(new URL('../supabase/migration-sources/dispatch-recovery/'+f,import.meta.url),'utf8')).join('');
  const dir=new URL('../supabase/migrations/',import.meta.url);
  const matches=readdirSync(dir).filter(f=>/^(?:next-\d{2}|\d{4})_edge_invocation_apikey\.sql$/.test(f));
  assert.equal(matches.length,1,'exactly one dispatch migration, pending or assigned');
  assert.equal(readFileSync(new URL(matches[0],dir),'utf8'),expected);
});
