-- 0216 — FR-TRANSLATE-003: purge cached post translations on content edit.
-- Phase 1a purged on delete + admin-removal only; an edited title/description
-- would otherwise serve a stale translation forever. Re-translation happens
-- lazily on the next read (cache miss).
set search_path = public;

create or replace function public.content_translations_purge_post_on_edit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.title is distinct from old.title
     or new.description is distinct from old.description then
    delete from public.content_translations
     where content_type = 'post' and content_id = new.post_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_content_translations_purge_post_edit on public.posts;
create trigger trg_content_translations_purge_post_edit
  after update of title, description on public.posts
  for each row execute function public.content_translations_purge_post_on_edit();
