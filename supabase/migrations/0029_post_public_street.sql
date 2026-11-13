-- Posts · the street other members see follows the poster's display level
-- (FR-POST-003 AC3, FR-POST-019 AC5; PM decision of 2026-11-11, docs/spec/90_decisions_log.md)
--
-- The exact address stays in `post_private_locations`, readable by the owner only. What the
-- poster chose to show is derived onto the post itself, like `geo_approx`, so the post's own
-- row security decides who reads it: the street when the level is `CityAndStreet` (the
-- default of a new post) or `FullAddress`, and the house number only with `FullAddress`.
-- `CityOnly` shows nothing. The exact point, the access notes and a ride's destination number
-- are never copied. The columns are derived by trigger and never written from a device.

alter table public.posts
  add column shown_street text,
  add column shown_street_number text;
comment on column public.posts.shown_street is
  'Street other members see: set from the private address when the display level is CityAndStreet or FullAddress. Derived.';
comment on column public.posts.shown_street_number is
  'House number other members see: set only with the FullAddress display level. Derived.';

-- Keeps the shown address derived on every write that could change it.
create function kc_private.posts_set_shown_address()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_street text;
  v_number text;
begin
  select l.street, l.street_number into v_street, v_number
    from public.post_private_locations l where l.post_id = new.id;
  new.shown_street := case when new.location_display_level in ('CityAndStreet', 'FullAddress') then v_street end;
  new.shown_street_number := case when new.location_display_level = 'FullAddress' and v_street is not null then v_number end;
  return new;
end;
$$;
comment on function kc_private.posts_set_shown_address() is
  'BEFORE INSERT / UPDATE on posts: derives shown_street and shown_street_number from the private address and the display level.';

-- The shown columns are in the list so that any write to them is overwritten too.
create trigger posts_set_shown_address
  before insert or update of location_display_level, shown_street, shown_street_number on public.posts
  for each row execute function kc_private.posts_set_shown_address();

-- Re-derives the shown address when the private street or number is set, changed or removed.
create function kc_private.post_private_locations_refresh_shown()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post_id constant uuid := case tg_op when 'DELETE' then old.post_id else new.post_id end;
begin
  -- Writing the column fires posts_set_shown_address, which computes the value.
  update public.posts p set shown_street = null where p.id = v_post_id;
  return null;
end;
$$;

create trigger post_private_locations_refresh_shown
  after insert or delete or update of street, street_number on public.post_private_locations
  for each row execute function kc_private.post_private_locations_refresh_shown();

-- Posts published before this migration.
update public.posts p set shown_street = null
 where exists (select 1 from public.post_private_locations l where l.post_id = p.id);
