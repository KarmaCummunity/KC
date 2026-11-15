-- 0361_money_nonprofit_public_rpcs | Browse nonprofits + public page with campaign progress.

begin;

create or replace function public.list_verified_nonprofits(p_limit int default 50)
returns table (
  org_id uuid,
  slug text,
  name text,
  tagline_he text,
  tagline_en text,
  is_verified_nonprofit boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.org_id,
    o.slug,
    o.name,
    o.public_tagline_he,
    o.public_tagline_en,
    o.is_verified_nonprofit
  from public.organizations o
  where o.is_verified_nonprofit
    and not o.is_platform
  order by o.name
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

revoke all on function public.list_verified_nonprofits(int) from public;
grant execute on function public.list_verified_nonprofits(int) to anon, authenticated;

create or replace function public.get_nonprofit_public_page(p_org_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org public.organizations%rowtype;
  v_raised numeric;
  v_campaigns jsonb;
begin
  select * into v_org from public.organizations
   where slug = p_org_slug and is_verified_nonprofit;
  if not found then
    return null;
  end if;

  select coalesce(sum(p.amount_ils), 0) into v_raised
    from public.payments p
   where p.org_id = v_org.org_id and p.status = 'succeeded';

  select coalesce(jsonb_agg(row_to_json(c)::jsonb order by c.published_at desc nulls last), '[]'::jsonb)
    into v_campaigns
  from (
    select
      l.listing_id,
      l.title,
      l.summary,
      l.status,
      l.published_at,
      coalesce((l.details->>'goal_ils')::numeric, 0) as goal_ils,
      (
        select coalesce(sum(p2.amount_ils), 0)
          from public.payments p2
         where p2.org_id = v_org.org_id
           and p2.status = 'succeeded'
           and (p2.intent_id in (
             select di.intent_id from public.donation_intents di
              where di.listing_id = l.listing_id
           ) or l.beneficiary_org_id = v_org.org_id)
      ) as raised_ils
    from public.listings l
    where l.beneficiary_org_id = v_org.org_id
      and l.world_slug = 'money'
      and l.moderation_status = 'published'
      and l.status in ('open', 'closed')
  ) c;

  return jsonb_build_object(
    'org_id', v_org.org_id,
    'slug', v_org.slug,
    'name', v_org.name,
    'tagline_he', v_org.public_tagline_he,
    'tagline_en', v_org.public_tagline_en,
    'about_he', v_org.public_about_he,
    'about_en', v_org.public_about_en,
    'is_verified_nonprofit', v_org.is_verified_nonprofit,
    'total_raised_ils', v_raised,
    'campaigns', v_campaigns
  );
end;
$$;

revoke all on function public.get_nonprofit_public_page(text) from public;
grant execute on function public.get_nonprofit_public_page(text) to anon, authenticated;

commit;
