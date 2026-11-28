-- Private native evidence is never visible or writable by application clients.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(8);
-- The throwaway baseline omits Storage API role grants. Grant them only in this
-- rolled-back test transaction so denials exercise RLS, not schema privileges.
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;
alter table storage.objects enable row level security;
select is((select count(*)::integer from pg_policies where schemaname='storage' and tablename='objects' and policyname='kc_native_evidence_client_deny' and permissive='RESTRICTIVE' and cmd='ALL'), 1, 'one restrictive all-operation isolation guard');
select ok((select roles @> array['anon','authenticated']::name[] from pg_policies where schemaname='storage' and policyname='kc_native_evidence_client_deny'), 'both ordinary roles guarded');
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('kc-native-evidence','kc-native-evidence',false,26214400,array['application/octet-stream']) on conflict(id) do nothing;
insert into storage.objects(bucket_id,name) values ('kc-native-evidence','ci-native-policy-test/evidence.cms');
select is((select count(*)::integer from storage.objects where bucket_id='kc-native-evidence' and name='ci-native-policy-test/evidence.cms'),1,'privileged controller sees probe');
set local role anon;
select is((select count(*)::integer from storage.objects where bucket_id='kc-native-evidence'),0,'anonymous cannot read evidence');
select throws_ok($$insert into storage.objects(bucket_id,name) values ('kc-native-evidence','ci-native-policy-test/anon.cms')$$,'42501',null,'anonymous cannot write evidence');
reset role;
set local role authenticated;
select is((select count(*)::integer from storage.objects where bucket_id='kc-native-evidence'),0,'authenticated cannot read evidence');
select throws_ok($$insert into storage.objects(bucket_id,name) values ('kc-native-evidence','ci-native-policy-test/auth.cms')$$,'42501',null,'authenticated cannot write evidence');
reset role;
select is((select count(*)::integer from storage.objects where bucket_id='kc-native-evidence' and name='ci-native-policy-test/evidence.cms'),1,'denied clients did not alter controller probe');
select * from finish();
rollback;
