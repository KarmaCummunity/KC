-- 0642_dev_mock_identity_verification | FR-VERIFY-005 (stub until IDV-1): level-2 for dev/test only.
-- Sets verified_at + verification_method = 'manual' and accepts housing conduct so publish works.
-- Allowed only when kc_dev_demo_config exists or app_flags.dev_mock_identity_verification is on.
begin;

insert into public.app_flags (key, enabled, description)
values (
  'dev_mock_identity_verification',
  false,
  'When true, members may call dev_grant_mock_identity_verification (non-production testing).'
)
on conflict (key) do nothing;

create or replace function public.dev_mock_identity_verification_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.kc_dev_demo_config)
      or coalesce(
        (select f.enabled from public.app_flags f where f.key = 'dev_mock_identity_verification'),
        false
      );
$$;

revoke all on function public.dev_mock_identity_verification_allowed() from public;
grant execute on function public.dev_mock_identity_verification_allowed() to authenticated;

create or replace function public.dev_grant_mock_identity_verification()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  if not public.dev_mock_identity_verification_allowed() then
    raise exception 'dev_mock_identity_verification_disabled' using errcode = '42501';
  end if;

  perform public.accept_housing_conduct(public.housing_conduct_version());

  update public.users
     set verified_at = coalesce(verified_at, now()),
         verification_method = 'manual'
   where user_id = v_uid;
end;
$$;

comment on function public.dev_grant_mock_identity_verification() is
  'Dev/staging only: FR-VERIFY-001 level 2 stub (manual) + housing conduct (FR-HOUSING-003). Replaced by provider webhook.';

revoke all on function public.dev_grant_mock_identity_verification() from public;
grant execute on function public.dev_grant_mock_identity_verification() to authenticated;

do $$
begin
  if exists (select 1 from public.kc_dev_demo_config) then
    update public.app_flags set enabled = true where key = 'dev_mock_identity_verification';
  end if;
end $$;

commit;
