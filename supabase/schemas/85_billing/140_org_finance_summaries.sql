-- Billing · summaries of an organization's books (FR-FIN-014, FR-FIN-023)
--
-- Two read-only aggregates over billing.org_finance_entries for the finance screens: the
-- income / expense totals of a period and the donors overview. Like every function of
-- 100_org_finance_rpcs.sql they take the organization and start with
-- kc_private.finance_assert, so a finance role of one organization never reads another's.
-- Both read org_finance_entries_org_idx (org_id, occurred_at desc, id desc).
-- Errors: forbidden (42501), unauthenticated (42501), account_not_active (P0001).

-- Cleared income and expenses of an organization in a period (both bounds optional and
-- inclusive), in agorot. Transfers between the organization's own accounts have no
-- direction and count nowhere; voided and pending entries are left out.
create function public.finance_ledger_summary(
  p_org_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (currency text, income_agorot bigint, expense_agorot bigint, net_agorot bigint, entry_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kc_private.finance_assert(p_org_id, 'view');
  return query
  select 'ILS'::text,
         coalesce(sum(e.amount_agorot) filter (where e.direction = 'in'), 0)::bigint,
         coalesce(sum(e.amount_agorot) filter (where e.direction = 'out'), 0)::bigint,
         (coalesce(sum(e.amount_agorot) filter (where e.direction = 'in'), 0)
          - coalesce(sum(e.amount_agorot) filter (where e.direction = 'out'), 0))::bigint,
         count(*)::integer
    from billing.org_finance_entries e
   where e.org_id = p_org_id and e.status = 'cleared' and e.direction is not null
     and (p_from is null or e.occurred_at >= p_from)
     and (p_to is null or e.occurred_at <= p_to);
end;
$$;
comment on function public.finance_ledger_summary(uuid, timestamptz, timestamptz) is
  'Finance roles: cleared income, expenses and net of an organization in a period, in agorot.';
grant execute on function public.finance_ledger_summary(uuid, timestamptz, timestamptz) to authenticated;

-- Who donated to an organization and how much (FR-FIN-023): cleared donation and grant
-- entries, grouped by donor, largest total first. A donation made in the app is grouped by
-- the donating member and named by their display name; a typed entry is grouped by its
-- party name, ignoring case and repeated spaces, and named by its latest spelling. Entries
-- without a donor — no party name, or a donor whose account was removed — form one group
-- whose name is null ("anonymous"). Organization administrators only (FR-FIN-023 AC2): the
-- `transparency` permission of finance_assert is exactly org_admin and platform admins.
create function public.finance_donors_summary(p_org_id uuid, p_limit integer default 200)
returns table (donor_name text, donations_count integer, total_agorot bigint, first_at timestamptz,
               last_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kc_private.finance_assert(p_org_id, 'transparency');
  return query
  select case when g.donor_user_id is not null then (select u.display_name from public.users u where u.id = g.donor_user_id)
              when g.party_key <> '' then g.latest_party end,
         g.donations, g.total, g.first_at, g.last_at
    from (select e.donor_user_id,
                 case when e.source = 'manual' then lower(regexp_replace(btrim(coalesce(e.counterparty, '')), '\s+', ' ', 'g'))
                      else '' end as party_key,
                 (array_agg(btrim(e.counterparty) order by e.occurred_at desc))[1] as latest_party,
                 count(*)::integer as donations,
                 sum(e.amount_agorot)::bigint as total,
                 min(e.occurred_at) as first_at,
                 max(e.occurred_at) as last_at
            from billing.org_finance_entries e
           where e.org_id = p_org_id and e.status = 'cleared' and e.kind in ('donation_in', 'grant_in')
           group by 1, 2) g
   order by g.total desc, g.last_at desc
   limit least(greatest(coalesce(p_limit, 200), 1), 500);
end;
$$;
comment on function public.finance_donors_summary(uuid, integer) is
  'Organization administrators: donors of an organization grouped by member or party name, largest total first.';
grant execute on function public.finance_donors_summary(uuid, integer) to authenticated;
