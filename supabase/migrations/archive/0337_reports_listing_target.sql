-- 0337_reports_listing_target | FR-MOD-001 extension for marketplace listings.

begin;

alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('post', 'user', 'chat', 'listing', 'none'));

create or replace function public.reports_validate_before_insert()
returns trigger
language plpgsql
as $$
begin
  if new.reporter_id is null or new.reporter_id <> auth.uid() then
    raise exception 'reporter_must_be_self' using errcode = 'check_violation';
  end if;

  if new.target_type = 'post' and exists (
    select 1 from public.posts
     where post_id = new.target_id
       and status  = 'removed_admin'
  ) then
    raise exception 'target_already_moderated'
      using errcode = 'P0020', detail = 'target_type=post';
  end if;

  if new.target_type = 'user' and exists (
    select 1 from public.users
     where user_id        = new.target_id
       and account_status in ('suspended_admin','banned')
  ) then
    raise exception 'target_already_moderated'
      using errcode = 'P0020', detail = 'target_type=user';
  end if;

  if new.target_type = 'chat' and exists (
    select 1 from public.chats
     where chat_id    = new.target_id
       and removed_at is not null
  ) then
    raise exception 'target_already_moderated'
      using errcode = 'P0020', detail = 'target_type=chat';
  end if;

  if new.target_type = 'listing' and exists (
    select 1 from public.listings l
     where l.listing_id = new.target_id
       and (l.moderation_status <> 'published' or l.status <> 'open')
  ) then
    raise exception 'target_already_moderated'
      using errcode = 'P0020', detail = 'target_type=listing';
  end if;

  if new.target_type = 'post' then
    if not exists (select 1 from public.posts where post_id = new.target_id) then
      raise exception 'report_target_not_visible'
        using errcode = 'check_violation', detail = 'target_type=post';
    end if;
    if (select owner_id from public.posts where post_id = new.target_id) = new.reporter_id then
      raise exception 'cannot_report_self' using errcode = 'check_violation';
    end if;
  elsif new.target_type = 'user' then
    if not exists (select 1 from public.users where user_id = new.target_id) then
      raise exception 'report_target_not_visible'
        using errcode = 'check_violation', detail = 'target_type=user';
    end if;
    if new.target_id = new.reporter_id then
      raise exception 'cannot_report_self' using errcode = 'check_violation';
    end if;
  elsif new.target_type = 'chat' then
    if not exists (
      select 1 from public.chats c
      where c.chat_id = new.target_id
        and new.reporter_id in (c.participant_a, c.participant_b)
    ) then
      raise exception 'report_target_not_visible'
        using errcode = 'check_violation', detail = 'target_type=chat';
    end if;
  elsif new.target_type = 'listing' then
    if not exists (
      select 1 from public.listings l
       where l.listing_id = new.target_id
         and public.is_listing_visible_to(l, new.reporter_id)
    ) then
      raise exception 'report_target_not_visible'
        using errcode = 'check_violation', detail = 'target_type=listing';
    end if;
    if (select owner_id from public.listings where listing_id = new.target_id) = new.reporter_id then
      raise exception 'cannot_report_self' using errcode = 'check_violation';
    end if;
  end if;

  if new.target_type <> 'none' and exists (
    select 1 from public.reports
    where reporter_id = new.reporter_id
      and target_type = new.target_type
      and target_id   = new.target_id
      and created_at  > now() - interval '24 hours'
  ) then
    raise exception 'duplicate_report'
      using errcode = 'unique_violation', detail = 'window=24h';
  end if;

  return new;
end;
$$;

commit;
