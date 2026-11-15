-- 0257_chat_v2_media_reactions | KC#873 — message reactions + media payload shape.

alter table public.messages drop constraint if exists messages_user_shape;
alter table public.messages drop constraint if exists messages_system_shape;

alter table public.messages
  add column if not exists media_payload jsonb;

comment on column public.messages.media_payload is
  'KC#873: {type:image|video|voice|location|post_share, ...}. Null for plain text user messages.';

alter table public.messages drop constraint if exists messages_kind_chk;
alter table public.messages
  add constraint messages_kind_chk
  check (kind in ('user', 'system', 'media'));

alter table public.messages
  add constraint messages_user_shape check (
    kind <> 'user' or (
      body is not null
      and char_length(body) between 1 and 2000
      and system_payload is null
      and media_payload is null
    )
  );

alter table public.messages
  add constraint messages_media_shape check (
    kind <> 'media' or (
      media_payload is not null
      and jsonb_typeof(media_payload) = 'object'
      and (media_payload ->> 'type') in ('image', 'video', 'voice', 'location', 'post_share')
    )
  );

alter table public.messages
  add constraint messages_system_shape check (
    kind <> 'system' or (system_payload is not null)
  );

create table if not exists public.message_reactions (
  reaction_id     uuid primary key default gen_random_uuid(),
  message_id      uuid not null references public.messages(message_id) on delete cascade,
  user_id         uuid not null references public.users(user_id) on delete cascade,
  reaction_type   text not null check (reaction_type in ('like', 'love', 'laugh', 'sad')),
  created_at      timestamptz not null default now(),
  unique (message_id, user_id)
);

create index if not exists message_reactions_message_idx on public.message_reactions (message_id);
create index if not exists message_reactions_user_idx on public.message_reactions (user_id, created_at desc);

alter table public.message_reactions enable row level security;
grant select, insert, delete on public.message_reactions to authenticated;

create policy message_reactions_select_chat_visible on public.message_reactions
  for select to authenticated
  using (
    exists (
      select 1
        from public.messages m
        join public.chats c on c.chat_id = m.chat_id
       where m.message_id = message_reactions.message_id
         and public.is_chat_visible_to(c.*, (select auth.uid()))
    )
  );

create policy message_reactions_insert_self on public.message_reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_active_member((select auth.uid()))
    and exists (
      select 1
        from public.messages m
        join public.chats c on c.chat_id = m.chat_id
       where m.message_id = message_reactions.message_id
         and public.is_chat_visible_to(c.*, (select auth.uid()))
    )
  );

create policy message_reactions_delete_self on public.message_reactions
  for delete to authenticated
  using (user_id = (select auth.uid()));
