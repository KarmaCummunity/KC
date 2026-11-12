-- Organizations · nonprofit and transparency pages are open to signed-out visitors, and a
-- campaign shows its goal (FR-ORG-001 AC4, FR-FIN-020 AC4, FR-FIN-022 AC2, FR-ORG-010;
-- PM decision of 2026-11-11, docs/spec/90_decisions_log.md)
--
-- Exactly three reads are granted to `anon`; the rest of the baseline stays closed to it.
-- Each runs with definer rights and returns only public profile fields and totals: never a
-- donor, a counterparty, an account, an entry or a member id.
--   list_verified_nonprofits   the directory: id, slug, name, taglines, verification level
--   get_nonprofit_public_page  one nonprofit: profile texts, total raised, its public campaign
--                              posts with what each raised, and now each campaign's goal and
--                              summary (the post's description)
--   rpc_org_transparency       the finance blocks the organization switched on
-- A campaign's goal is the `goal_ils` field of its post details, in whole shekels, returned in
-- agorot like every amount; 0 when the campaign set none.

create or replace function public.list_verified_nonprofits(
  p_limit integer default 50,
  p_after_name text default null,
  p_after_id uuid default null
)
returns table (id uuid, slug text, name text, tagline_he text, tagline_en text, verification_level smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.slug, o.name, o.public_tagline_he, o.public_tagline_en, o.verification_level
    from public.organizations o
   where o.is_verified_nonprofit and o.status = 'active' and not o.is_platform
     and (p_after_name is null or (o.name, o.id) > (p_after_name, p_after_id))
   order by o.name, o.id
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;
comment on function public.list_verified_nonprofits(integer, text, uuid) is
  'Verified nonprofits that may receive donations, by name (keyset). Public profile fields only; open to signed-out visitors.';
grant execute on function public.list_verified_nonprofits(integer, text, uuid) to anon;

create or replace function public.get_nonprofit_public_page(p_org_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'org_id', o.id, 'slug', o.slug, 'name', o.name,
    'tagline_he', o.public_tagline_he, 'tagline_en', o.public_tagline_en,
    'about_he', o.public_about_he, 'about_en', o.public_about_en,
    'is_verified_nonprofit', o.is_verified_nonprofit, 'verification_level', o.verification_level,
    'sec46_active', o.sec46_status = 'active' and current_date between o.sec46_valid_from and o.sec46_valid_until,
    'total_raised_agorot', (
      select coalesce(sum(p.amount_agorot - p.refunded_agorot), 0)
        from billing.payments p
       where p.org_id = o.id and p.status = 'succeeded'),
    'campaigns', coalesce((
      select jsonb_agg(jsonb_build_object(
               'post_id', c.id, 'title', c.title, 'status', c.status, 'published_at', c.published_at,
               'summary', c.description,
               'goal_agorot', case when c.details ->> 'goal_ils' ~ '^[0-9]{1,9}(\.[0-9]{1,2})?$'
                                   then round((c.details ->> 'goal_ils')::numeric * 100)::bigint else 0 end,
               'raised_agorot', (
                 select coalesce(sum(p.amount_agorot - p.refunded_agorot), 0)
                   from billing.donation_intents i
                   join billing.payments p on p.intent_id = i.id and p.status = 'succeeded'
                  where i.post_id = c.id))
             order by c.published_at desc)
        from public.posts c
       where c.beneficiary_org_id = o.id and c.world_slug = 'money' and c.visibility = 'Public'
         and c.status in ('open', 'closed_delivered')), '[]'::jsonb))
    from public.organizations o
   where o.slug = p_org_slug and o.is_verified_nonprofit and o.status = 'active';
$$;
comment on function public.get_nonprofit_public_page(text) is
  'Donations page of a verified nonprofit: profile texts, total raised, campaigns with goal and progress. Totals only; open to signed-out visitors.';
grant execute on function public.get_nonprofit_public_page(text) to anon;

create or replace function public.rpc_org_transparency(p_slug text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
  v_income bigint;
  v_expense bigint;
  v_program bigint;
  v_count bigint;
  v_last timestamptz;
  v_result jsonb;
begin
  select o.* into v_org from public.organizations o
   where o.status = 'active' and case when p_slug is null then o.is_platform else o.slug = p_slug end;
  if not found or not (v_org.show_totals or v_org.show_donations_count or v_org.show_program_ratio
                       or v_org.show_category_breakdown or v_org.show_monthly_trend) then
    return jsonb_build_object('enabled', false);
  end if;

  select coalesce(sum(e.amount_agorot) filter (where e.direction = 'in'), 0),
         coalesce(sum(e.amount_agorot) filter (where e.direction = 'out'), 0),
         coalesce(sum(e.amount_agorot) filter (where e.direction = 'out' and e.category = 'program'), 0),
         count(*) filter (where e.kind in ('donation_in', 'grant_in')),
         max(e.occurred_at)
    into v_income, v_expense, v_program, v_count, v_last
    from billing.org_finance_entries e
   where e.org_id = v_org.id and e.status = 'cleared' and e.is_public and e.direction is not null;

  v_result := jsonb_build_object('enabled', true, 'currency', 'ILS', 'last_entry_at', v_last);
  if v_org.show_totals then
    v_result := v_result || jsonb_build_object(
      'income_agorot', v_income, 'expense_agorot', v_expense, 'net_agorot', v_income - v_expense);
  end if;
  if v_org.show_donations_count then
    v_result := v_result || jsonb_build_object('donations_count', v_count);
  end if;
  if v_org.show_program_ratio and v_expense > 0 then
    v_result := v_result || jsonb_build_object('program_ratio', round(v_program::numeric / v_expense, 4));
  end if;
  if v_org.show_category_breakdown then
    v_result := v_result || jsonb_build_object('by_category', coalesce((
      select jsonb_agg(jsonb_build_object('key', c.key, 'agorot', c.agorot) order by c.agorot desc)
        from (select case when e.category in ('program', 'payroll', 'rent_ops', 'marketing_fundraising',
                                              'admin_general', 'fees', 'donor_refunds')
                          then e.category else 'other_out' end as key,
                     sum(e.amount_agorot)::bigint as agorot
                from billing.org_finance_entries e
               where e.org_id = v_org.id and e.status = 'cleared' and e.is_public and e.direction = 'out'
               group by 1) c), '[]'::jsonb));
  end if;
  if v_org.show_monthly_trend then
    -- The last twelve calendar months, empty ones included.
    v_result := v_result || jsonb_build_object('monthly', (
      select jsonb_agg(jsonb_build_object('month', to_char(s.month, 'YYYY-MM'), 'income_agorot', s.income,
                                          'expense_agorot', s.expense) order by s.month)
        from (select m.month,
                     coalesce(sum(e.amount_agorot) filter (where e.direction = 'in'), 0)::bigint as income,
                     coalesce(sum(e.amount_agorot) filter (where e.direction = 'out'), 0)::bigint as expense
                from generate_series(date_trunc('month', now()) - interval '11 months',
                                     date_trunc('month', now()), interval '1 month') as m (month)
                left join billing.org_finance_entries e
                  on e.org_id = v_org.id and e.status = 'cleared' and e.is_public and e.direction is not null
                 and date_trunc('month', e.occurred_at) = m.month
               group by m.month) s));
  end if;
  return v_result;
end;
$$;
comment on function public.rpc_org_transparency(text) is
  'Live public finance numbers of an organization, limited to the blocks it switched on. Totals only; open to signed-out visitors.';
grant execute on function public.rpc_org_transparency(text) to anon;
