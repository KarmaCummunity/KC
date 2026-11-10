-- Foundation · shared trigger functions

-- Stamps `updated_at` on every row update. Attached as a BEFORE UPDATE trigger by each table
-- that has the column, so the value never depends on the client clock.
create function kc_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
comment on function kc_private.set_updated_at() is 'BEFORE UPDATE trigger: sets updated_at to the transaction time.';
