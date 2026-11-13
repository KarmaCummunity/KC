-- Audit · deletion tombstones (design §4.1.4)
--
-- Proof that an account was deleted, without keeping the account: a salted hash of the
-- member id and the two dates. Given an id, operations can show that it was purged and
-- when; the table alone identifies nobody.

-- The salt of the hash: one random value per database, created on first use, readable by
-- no API role (the service role included).
create table kc_private.audit_tombstone_salt (
  singleton boolean primary key default true check (singleton),
  salt      bytea not null check (octet_length(salt) >= 32)
);
comment on table kc_private.audit_tombstone_salt is 'Per-database salt of deletion tombstone hashes. One row, never exposed.';
alter table kc_private.audit_tombstone_salt enable row level security;
alter table kc_private.audit_tombstone_salt force row level security;
revoke all on kc_private.audit_tombstone_salt from service_role;

create table audit.deletion_tombstones (
  -- sha256(salt || member id).
  user_hash    bytea primary key check (octet_length(user_hash) = 32),
  -- When the member asked for the deletion; null when the account was removed without a request.
  requested_at timestamptz,
  purged_at    timestamptz not null default now()
);
comment on table audit.deletion_tombstones is 'Salted hash and dates of each purged account. Append-only.';

alter table audit.deletion_tombstones enable row level security;
alter table audit.deletion_tombstones force row level security;
revoke all on audit.deletion_tombstones from service_role;
grant select on audit.deletion_tombstones to service_role;

create trigger deletion_tombstones_append_only
  before update or delete on audit.deletion_tombstones
  for each row execute function kc_private.audit_reject_change();
create trigger deletion_tombstones_no_truncate
  before truncate on audit.deletion_tombstones
  for each statement execute function kc_private.audit_reject_change();

-- The tombstone hash of a member id.
create function kc_private.audit_tombstone_hash(p_user_id uuid)
returns bytea
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_salt bytea;
begin
  insert into kc_private.audit_tombstone_salt (salt)
  values (uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()))
  on conflict (singleton) do nothing;
  select s.salt into strict v_salt from kc_private.audit_tombstone_salt s;
  return sha256(v_salt || uuid_send(p_user_id));
end;
$$;
comment on function kc_private.audit_tombstone_hash(uuid) is
  'Salted hash under which a purged member is remembered; also answers "was this id purged?".';

-- Called by the purge job for each account, in the transaction that removes it (before the
-- auth account is deleted, so the request date is still there). Idempotent: a purge that
-- is retried after a failed step leaves one tombstone. The audit event names the hash,
-- not the member.
create function kc_private.audit_record_deletion(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash constant bytea := kc_private.audit_tombstone_hash(p_user_id);
begin
  insert into audit.deletion_tombstones (user_hash, requested_at)
  values (v_hash, (select a.deletion_requested_at from public.user_account a where a.user_id = p_user_id))
  on conflict (user_hash) do nothing;
  if found then
    perform kc_private.audit_record(
      'account_purged', 'user', null, jsonb_build_object('tombstone', encode(v_hash, 'hex')), null);
  end if;
end;
$$;
comment on function kc_private.audit_record_deletion(uuid) is
  'Purge job: leaves the tombstone of an account that is about to be removed.';
