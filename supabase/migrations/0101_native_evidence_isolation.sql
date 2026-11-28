-- Isolate private encrypted native acceptance staging from all application clients.
-- No bucket creation and no service credential is embedded in this migration.
-- Signed single-object uploads are minted only by the privileged controller.
do $native_evidence$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'kc_native_evidence_client_deny'
  ) then
    create policy kc_native_evidence_client_deny
      on storage.objects as restrictive for all to anon, authenticated
      using (bucket_id <> 'kc-native-evidence')
      with check (bucket_id <> 'kc-native-evidence');
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'kc_native_evidence_client_deny'
      and permissive = 'RESTRICTIVE' and cmd = 'ALL'
      and roles @> array['anon', 'authenticated']::name[]
      and qual = '(bucket_id <> ''kc-native-evidence''::text)'
      and with_check = '(bucket_id <> ''kc-native-evidence''::text)'
  ) then
    raise exception 'Private native evidence policy differs from reviewed isolation';
  end if;
end
$native_evidence$;
