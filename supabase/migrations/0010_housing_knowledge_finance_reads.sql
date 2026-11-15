-- Worlds and billing · housing trust counts, knowledge slot seats, org finance summaries
--
-- Three reads the housing and knowledge worlds and the organization finance screens need:
-- the completed-stays number of the housing trust block (S16), the places left per slot of a
-- knowledge offer (FR-KNOW-004), and the ledger and donors summaries of an organization's
-- books (FR-FIN-014, FR-FIN-023).

-- Worlds · completed stays in a member's housing trust block (S16, D24)
--
-- Stay cards, the host's booking panel and the guest's stays show a member's verification,
-- seniority and the number of housing bookings they completed (FR-HOUSING-013 AC1,
-- FR-HOUSING-021 AC2, FR-HOUSING-036 AC2), never a rating. The bookings behind the number are
-- visible to their two members only, so the count is taken by a definer helper and released
-- through a function that runs with the caller's rights: row security on `users` decides
-- whose count comes back, exactly as for the profile itself.

-- Completed stays of a member, as host or as guest. Reads post_handoffs_owner_recent_idx
-- and post_handoffs_recipient_recent_idx, both led by the member id.
create function kc_access.housing_completed_stays_of(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.post_handoffs h
   where (h.owner_id = p_user_id or h.recipient_id = p_user_id)
     and h.machine_id = 'housing_booking' and h.status = 'handed_over';
$$;
comment on function kc_access.housing_completed_stays_of(uuid) is
  'Housing bookings a member completed as host or guest; released only through housing_completed_stays.';
grant execute on function kc_access.housing_completed_stays_of(uuid) to authenticated;

-- Completed stays of the listed members whose profile the caller can read (at most 100
-- ids). One row per readable member; other ids are left out.
create function public.housing_completed_stays(p_user_ids uuid[])
returns table (user_id uuid, completed_stays integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select u.id, kc_access.housing_completed_stays_of(u.id)
    from public.users u
   where u.id = any (p_user_ids[1:100]);
$$;
comment on function public.housing_completed_stays(uuid[]) is
  'Completed housing bookings of the listed members whose profile the caller can read (trust block, S16).';
grant execute on function public.housing_completed_stays(uuid[]) to authenticated;

-- Worlds · places left in the slots of a knowledge offer (FR-KNOW-004)
--
-- A learner picks a slot that still has room, so every reader of a knowledge offer sees each
-- slot with its places left. The bookings behind the number are visible to their two members
-- only, so the count is taken by kc_private.knowledge_slot_seats_taken (definer) through a
-- kc_access wrapper, and released by a function that runs with the caller's rights: row
-- security on `post_knowledge_slots` (visible exactly when the post is) decides which slots
-- come back.

create function kc_access.knowledge_slot_seats_taken(p_post_id uuid, p_starts_at timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select kc_private.knowledge_slot_seats_taken(p_post_id, p_starts_at);
$$;
comment on function kc_access.knowledge_slot_seats_taken(uuid, timestamptz) is
  'Places of a knowledge slot held by bookings; released only through knowledge_slot_seats.';
grant execute on function kc_access.knowledge_slot_seats_taken(uuid, timestamptz) to authenticated;

-- The slots of a knowledge offer the caller can read, in time order, each with its places,
-- the places held and the places left. Reads the index of
-- post_knowledge_slots_no_overlap_excl (led by post_id) and post_handoffs_post_status_idx.
create function public.knowledge_slot_seats(p_post_id uuid)
returns table (id uuid, starts_at timestamptz, ends_at timestamptz, capacity integer, seats_taken integer,
               seats_left integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.id, s.starts_at, s.ends_at, s.capacity::integer, t.taken, greatest(s.capacity - t.taken, 0)
    from public.post_knowledge_slots s
   cross join lateral (select kc_access.knowledge_slot_seats_taken(s.post_id, s.starts_at) as taken) t
   where s.post_id = p_post_id
   order by s.starts_at;
$$;
comment on function public.knowledge_slot_seats(uuid) is
  'Slots of a knowledge offer the caller can read, with places held and places left.';
grant execute on function public.knowledge_slot_seats(uuid) to authenticated;

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
