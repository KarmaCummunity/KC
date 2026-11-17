-- External post import: link an import to the post the member publishes from its draft
-- (FR-IMPORT-007 AC3, ADR-008). The create path of the post is unchanged; once the post exists the
-- app calls api_import_attach_post, which marks it as imported, records where it came from and
-- ties the import record to it. Members cannot write `posts.source` themselves.

-- Where the member says the text came from. Null on every post that was not imported.
alter table public.posts add column source_platform text
  check (source_platform in ('whatsapp', 'facebook', 'yad2', 'other', 'unknown'));
alter table public.posts add constraint posts_source_platform_chk
  check (source = 'imported' or source_platform is null);
comment on column public.posts.source_platform is
  'Platform an imported post came from, as the member said (FR-IMPORT-007 AC3); null unless source = imported.';

-- Marks the caller's post as imported from the caller's import record, and links the two. Idempotent
-- for the same pair; an import can belong to one post only. Runs with the owner's rights (the post
-- columns are not writable by members) after checking that both rows are the caller's.
create function public.api_import_attach_post(p_import_id uuid, p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      constant uuid := (select auth.uid());
  v_import   public.external_post_imports%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_import
    from public.external_post_imports i
   where i.id = p_import_id and i.user_id = v_uid
   for update;
  if not found then
    raise exception 'import_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.posts p where p.id = p_post_id and p.owner_id = v_uid) then
    raise exception 'post_not_found' using errcode = 'P0002';
  end if;
  -- One import, one post: a second post cannot claim the same import.
  if v_import.post_id is not null and v_import.post_id <> p_post_id then
    raise exception 'import_already_used' using errcode = '23505';
  end if;

  update public.posts
     set source = 'imported', source_platform = v_import.source_platform
   where id = p_post_id;
  update public.external_post_imports
     set post_id = p_post_id, status = 'published'
   where id = p_import_id;
end;
$$;
comment on function public.api_import_attach_post(uuid, uuid) is
  'Marks the caller''s post as imported from the caller''s import record and links them (FR-IMPORT-007 AC3).';

revoke all on function public.api_import_attach_post(uuid, uuid) from public;
grant execute on function public.api_import_attach_post(uuid, uuid) to authenticated;
