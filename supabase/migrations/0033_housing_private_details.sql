-- Housing · the apartment, floor and entrance of a stay round-trip on edit (FR-HOUSING, spec 21)
--
-- The baseline folded them into the one free-text `access_notes`, so a host who edited a stay
-- found them blank. They are separate fields of the exact address again, private like the
-- rest of it: readable by the owner and, through get_post_private_location, by the guest of a
-- confirmed stay (every release audited). The access notes keep the free-text instructions.

alter table public.post_private_locations
  add column apartment      text check (char_length(btrim(apartment)) between 1 and 20),
  add column floor          text check (char_length(btrim(floor)) between 1 and 10),
  add column entrance_notes text check (char_length(btrim(entrance_notes)) between 1 and 120);
comment on column public.post_private_locations.apartment is 'Apartment number or name of a stay; private like the address.';
comment on column public.post_private_locations.floor is 'Floor of a stay; private like the address.';
comment on column public.post_private_locations.entrance_notes is 'Which entrance or gate of a stay; private like the address.';

grant insert (apartment, floor, entrance_notes) on public.post_private_locations to authenticated;
grant update (apartment, floor, entrance_notes) on public.post_private_locations to authenticated;
