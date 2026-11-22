-- Knowledge · consulting hour complete-profile gate (FR-KNOW-012 AC1, D184, #2038)
--
-- A consulting hour needs a complete profile (verification_level ≥ 1) and a profession
-- declaration, without identity verification (S70 → D184). Profession is already required
-- by post_kinds.detail_schema; this trigger enforces the profile level on insert / kind change.

create or replace function public.posts_consulting_complete_profile_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_kind_changed boolean := tg_op = 'INSERT' or old.kind_id is distinct from new.kind_id;
  v_level smallint;
begin
  if new.world_slug <> 'knowledge' or coalesce(new.source, 'native') <> 'native' then
    return new;
  end if;
  select k.slug into v_kind from public.post_kinds k where k.id = new.kind_id;
  if v_kind is distinct from 'consulting_hour' then
    return new;
  end if;
  if not v_kind_changed and tg_op = 'UPDATE' then
    return new;
  end if;
  select u.verification_level into v_level from public.users u where u.id = new.owner_id;
  if coalesce(v_level, 0) < 1 then
    raise exception 'consulting_requires_complete_profile' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
comment on function public.posts_consulting_complete_profile_gate() is
  'FR-KNOW-012 AC1 / D184: a consulting hour needs a complete profile, not ID verification.';

drop trigger if exists posts_consulting_complete_profile_gate on public.posts;
create trigger posts_consulting_complete_profile_gate
  before insert or update of kind_id, owner_id on public.posts
  for each row when (new.world_slug = 'knowledge')
  execute function public.posts_consulting_complete_profile_gate();

revoke all on function public.posts_consulting_complete_profile_gate() from public, anon, authenticated;
