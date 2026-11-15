-- Billing · what every signed-in member may see of an organization's money
--
-- Two read-only pages, for signed-in members only (design §12.1: nothing for signed-out
-- callers). Both return totals, never a donor, a counterparty, an account or an entry
-- (FR-FIN-019 AC6, FR-FIN-022 AC3).

-- The donations page of a verified nonprofit (FR-ORG-010): its profile texts, the total
-- raised through the product and its campaign posts with what each raised. Null for an
-- unknown, suspended or unverified organization.
create function public.get_nonprofit_public_page(p_org_slug text)
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
   where o.slug = p_org_slug and o.is_verified_nonprofit and o.status = 'active'
     and (select auth.uid()) is not null;
$$;
comment on function public.get_nonprofit_public_page(text) is
  'Donations page of a verified nonprofit: profile texts, total raised and campaigns. Totals only.';
grant execute on function public.get_nonprofit_public_page(text) to authenticated;

-- Live public finance numbers of an organization (FR-FIN-022, D111); p_slug null = the
-- platform organization. Only the blocks the organization switched on are returned, computed
-- over cleared public entries, transfers aside; `{"enabled": false}` when the organization
-- is unknown or shows nothing. Expense categories outside the app's list fold into
-- `other_out` (the list mirrors FINANCE_EXPENSE_CATEGORIES of @kc/domain).
create function public.rpc_org_transparency(p_slug text default null)
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
  perform kc_private.require_caller();
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
  'Live public finance numbers of an organization, limited to the blocks it switched on. Totals only.';
grant execute on function public.rpc_org_transparency(text) to authenticated;
