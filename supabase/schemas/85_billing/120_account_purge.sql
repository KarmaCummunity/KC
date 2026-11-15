-- Billing · money records of a purged account (design §4.1.4, §12 Q5)
--
-- When an account is purged its money records stay: payments, receipts, donation intents,
-- standing orders and the organizations' book entries are statutory records. What goes is
-- the link to the person — `user_id` is replaced by the account's deletion tombstone (the
-- salted hash of audit.deletion_tombstones), so the rows of one former member still
-- belong together and can be matched to a tombstone, but name nobody.
--
-- How long they are then kept is one setting (billing.settings.retention_after_account_deletion).
-- It is empty until the legal question is answered, and while it is empty nothing is due.
-- This baseline erases nothing: the function at the end only lists what a future purge
-- may take.

-- One row per purged member who left money records behind.
create table billing.detached_parties (
  user_tombstone bytea primary key check (octet_length(user_tombstone) = 32),
  detached_at    timestamptz not null default now()
);
comment on table billing.detached_parties is 'Tombstones of purged members with money records, and when they were detached.';
alter table billing.detached_parties enable row level security;
alter table billing.detached_parties force row level security;
revoke insert, update, delete, truncate on billing.detached_parties from service_role;

-- Detaches a member's money records from their account. The purge job calls it for each
-- account before it removes the auth identity; calling it again, or for a member without
-- money records, changes nothing. Open standing orders and unpaid intents are cancelled:
-- nobody is left to charge.
create function kc_private.billing_detach_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash constant bytea := kc_private.audit_tombstone_hash(p_user_id);
  v_rows bigint := 0;
  v_step bigint;
begin
  update billing.standing_orders o
     set user_id = null, user_tombstone = v_hash,
         status = 'cancelled', next_charge_at = null,
         cancelled_at = coalesce(o.cancelled_at, now())
   where o.user_id = p_user_id;
  get diagnostics v_rows = row_count;
  update billing.donation_intents i
     set user_id = null, user_tombstone = v_hash,
         status = case when i.status in ('created', 'checkout') then 'cancelled' else i.status end
   where i.user_id = p_user_id;
  get diagnostics v_step = row_count;
  v_rows := v_rows + v_step;
  update billing.payments p set user_id = null, user_tombstone = v_hash where p.user_id = p_user_id;
  update billing.receipts r set user_id = null, user_tombstone = v_hash where r.user_id = p_user_id;
  update billing.org_finance_entries e set donor_user_id = null, donor_tombstone = v_hash
   where e.donor_user_id = p_user_id;
  get diagnostics v_step = row_count;
  v_rows := v_rows + v_step;

  if v_rows > 0 then
    insert into billing.detached_parties (user_tombstone) values (v_hash) on conflict do nothing;
    perform kc_private.audit_record('billing_user_detached', 'user', null,
                                    jsonb_build_object('tombstone', encode(v_hash, 'hex')), null);
  end if;
end;
$$;
comment on function kc_private.billing_detach_user(uuid) is
  'Purge job: replaces a member''s reference in the money records by their deletion tombstone.';

-- Safety net: the same detachment runs whenever a member row is deleted, so an account
-- removal can neither fail on a money record nor take one with it, whichever path deletes
-- the account. The foreign keys (`on delete set null`) then find nothing left to clear.
create function kc_private.users_detach_billing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kc_private.billing_detach_user(old.id);
  return old;
end;
$$;

create trigger users_detach_billing
  before delete on public.users
  for each row execute function kc_private.users_detach_billing();

-- Tombstones whose retention period has ended. Empty while the period is not set.
create function kc_private.billing_detached_past_retention()
returns setof bytea
language sql
stable
security definer
set search_path = ''
as $$
  select d.user_tombstone
    from billing.detached_parties d
   cross join billing.settings s
   where d.detached_at <= now() - s.retention_after_account_deletion;
$$;
comment on function kc_private.billing_detached_past_retention() is
  'Tombstones of purged members whose money records are past the retention period; none while the period is unset.';
