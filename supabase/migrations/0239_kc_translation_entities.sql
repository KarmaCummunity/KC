-- 0239_kc_translation_entities — Smart UGC translation entities on KC content_translations.
-- Extends cache CHECK constraints for ride listings and public profile biography.
-- Self-clean on source delete / ride cancel (mirrors posts/messages).

alter table public.content_translations drop constraint if exists content_translations_type_chk;
alter table public.content_translations
  add constraint content_translations_type_chk
  check (content_type in ('post', 'message', 'ride_listing', 'user'));

alter table public.content_translations drop constraint if exists content_translations_field_chk;
alter table public.content_translations
  add constraint content_translations_field_chk
  check (field in ('title', 'description', 'body', 'biography'));

create or replace function public.content_translations_purge_ride_listing()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.content_translations
   where content_type = 'ride_listing' and content_id = old.ride_id;
  return old;
end;
$$;

drop trigger if exists trg_content_translations_purge_ride on public.ride_listings;
create trigger trg_content_translations_purge_ride
  before delete on public.ride_listings
  for each row execute function public.content_translations_purge_ride_listing();

create or replace function public.content_translations_purge_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.content_translations
   where content_type = 'user' and content_id = old.user_id;
  return old;
end;
$$;

drop trigger if exists trg_content_translations_purge_user on public.users;
create trigger trg_content_translations_purge_user
  before delete on public.users
  for each row execute function public.content_translations_purge_user();

create or replace function public.content_translations_purge_ride_on_edit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.title is distinct from old.title
     or new.description is distinct from old.description then
    delete from public.content_translations
     where content_type = 'ride_listing' and content_id = new.ride_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_content_translations_purge_ride_edit on public.ride_listings;
create trigger trg_content_translations_purge_ride_edit
  after update of title, description on public.ride_listings
  for each row execute function public.content_translations_purge_ride_on_edit();

create or replace function public.content_translations_purge_user_biography_edit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.biography is distinct from old.biography then
    delete from public.content_translations
     where content_type = 'user' and content_id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_content_translations_purge_user_bio on public.users;
create trigger trg_content_translations_purge_user_bio
  after update of biography on public.users
  for each row execute function public.content_translations_purge_user_biography_edit();
