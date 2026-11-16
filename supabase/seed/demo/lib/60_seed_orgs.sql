-- Demo data (FR-ADMIN-031) · restore phase "orgs": three verified [DEMO] nonprofits for the
-- money world, each with a small team of demo members. AC10: the admin who runs the restore
-- becomes an org admin of each, so the organization screens can be tried at once. The wipe
-- removes the nonprofits; their grants and memberships cascade with them.

create or replace function kc_private.demo_seed_orgs(p_actor_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ids constant uuid[] := kc_private.demo_org_ids();
  v_members constant uuid[] := kc_private.demo_member_ids();
  v_cities constant text[] := kc_private.demo_city_pool();
  v_created integer;
begin
  insert into public.organizations (
    id, slug, name, org_type, verification_level, verification_method, verified_at, is_verified_nonprofit,
    public_tagline_he, public_tagline_en, public_about_he, public_about_en, city_id)
  select v_ids[o.n], o.slug, o.name, 'nonprofit_association', 2, 'manual', now(), true,
         o.tagline_he, o.tagline_en,
         'עמותת הדגמה לסביבת הפיתוח בלבד. אין לתרום כסף אמיתי.',
         'Demo nonprofit for the dev environment only. Do not send real money.',
         v_cities[1 + o.n % greatest(cardinality(v_cities), 1)]
    from (values
      (1, 'demo-lev-cham', '[DEMO] קרן לב חם', 'עמותת הדגמה – סל מזון לחגים', 'Demo nonprofit – holiday food baskets'),
      (2, 'demo-yadayim-ptuchot', '[DEMO] ידיים פתוחות', 'עמותת הדגמה – ציוד לימודי לילדים',
          'Demo nonprofit – school supplies for kids'),
      (3, 'demo-bayit-lechol-chaya', '[DEMO] בית לכל חיה', 'עמותת הדגמה – אימוץ וטיפול בבעלי חיים',
          'Demo nonprofit – animal adoption and care')
    ) o (n, slug, name, tagline_he, tagline_en)
  on conflict (id) do nothing;
  get diagnostics v_created = row_count;

  -- Team per nonprofit: one demo org admin with two volunteers reporting to the org (no
  -- manager line); org memberships follow from the grants by trigger.
  if cardinality(v_members) >= 9 then
    insert into public.admin_role_grants (user_id, role, scope_org_id)
    select v_members[t.member], t.role, v_ids[t.org]
      from (select o as org, (o - 1) * 3 + 1 as member, 'org_admin' as role from generate_series(1, 3) o
            union all
            select o, (o - 1) * 3 + 1 + v, 'org_volunteer' from generate_series(1, 3) o cross join generate_series(1, 2) v) t
    on conflict do nothing;
  end if;

  -- AC10: the admin running the restore manages each demo nonprofit too.
  if p_actor_id is not null and exists (select 1 from public.users u where u.id = p_actor_id) then
    insert into public.admin_role_grants (user_id, role, scope_org_id, granted_by)
    select p_actor_id, 'org_admin', org_id, p_actor_id from unnest(v_ids) org_id
    on conflict do nothing;
  end if;
  return v_created;
end;
$$;
comment on function kc_private.demo_seed_orgs(uuid) is
  'Demo restore phase "orgs": the three [DEMO] nonprofits, a demo team for each, and the acting admin as org admin.';
