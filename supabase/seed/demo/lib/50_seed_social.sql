-- Demo data (FR-ADMIN-031) · restore phases "social" and "chats": who follows whom, saved
-- posts, and conversations about the demo posts. Positions come from the row number, so each
-- restore produces the same graph.

-- About 1,500 follows and 400 saved posts among the demo members. Returns the follows created.
create or replace function kc_private.demo_seed_social()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_members constant uuid[] := kc_private.demo_member_ids();
  v_n constant integer := cardinality(kc_private.demo_member_ids());
  v_posts uuid[];
  v_follows integer;
begin
  if v_n < 2 then
    return 0;
  end if;

  -- Each follower i follows the members at a few fixed offsets from it; never itself.
  insert into public.follows (follower_id, followed_id, created_at)
  select v_members[1 + i % v_n], v_members[1 + (i + o) % v_n], now() - make_interval(days => (i * o) % 90)
    from generate_series(0, v_n - 1) i
   cross join unnest(array[1, 3, 7, 12, 20, 33, 50, 71]) o
   where o % v_n <> 0
  on conflict do nothing;
  get diagnostics v_follows = row_count;

  select coalesce(array_agg(p.id order by p.id), '{}') into v_posts
    from public.posts p
   where p.owner_id = any (v_members) and p.status = 'open' and p.visibility = 'Public';
  if cardinality(v_posts) > 0 then
    insert into public.saved_posts (user_id, post_id)
    select v_members[1 + (g * 3) % v_n], v_posts[1 + (g * 29) % cardinality(v_posts)]
      from generate_series(1, 400) g
    on conflict do nothing;
  end if;
  return v_follows;
end;
$$;
comment on function kc_private.demo_seed_social() is
  'Demo restore phase "social": follows and saved posts among the demo members.';

-- 150 direct chats, each about a public demo item post between its owner and another demo
-- member, with six messages. The asker has read the thread; the owner has the last message
-- unread, so inbox badges have something to show. Returns the number of chats created.
create or replace function kc_private.demo_seed_chats()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_lines constant text[] := array['היי, זה עדיין רלוונטי?', 'כן, עדיין זמין 🙂', 'מתי נוח לך לאסוף?',
    'אפשר מחר אחרי 17:00?', 'מעולה, אני שולח/ת כתובת מדויקת', 'תודה רבה!!'];
  v_members constant uuid[] := kc_private.demo_member_ids();
  v_n constant integer := cardinality(kc_private.demo_member_ids());
  v_chat record;
  v_chat_id uuid;
  v_created integer := 0;
begin
  if v_n < 2 then
    return 0;
  end if;

  -- One chat per pair of members: the first public item post of the pair is its anchor.
  for v_chat in
    with candidate as (
      select p.id as post_id, p.owner_id,
             v_members[1 + (row_number() over (order by p.id) * 11) % v_n] as asker
        from public.posts p
       where p.owner_id = any (v_members) and p.world_slug = 'items'
         and p.status = 'open' and p.visibility = 'Public')
    select distinct on (least(c.owner_id, c.asker), greatest(c.owner_id, c.asker)) c.post_id, c.owner_id, c.asker
      from candidate c
     where c.asker <> c.owner_id
     order by least(c.owner_id, c.asker), greatest(c.owner_id, c.asker), c.post_id
     limit 150
  loop
    insert into public.chats (kind, direct_user_a, direct_user_b, anchor_post_id)
    values ('direct', least(v_chat.owner_id, v_chat.asker), greatest(v_chat.owner_id, v_chat.asker), v_chat.post_id)
    on conflict do nothing
    returning id into v_chat_id;
    continue when v_chat_id is null;

    insert into public.chat_members (chat_id, user_id) values (v_chat_id, v_chat.owner_id), (v_chat_id, v_chat.asker);
    -- Odd lines are the asker's, even lines the owner's reply; times are stamped by trigger.
    insert into public.messages (chat_id, sender_id, kind, body, source_language)
    select v_chat_id, case when k % 2 = 1 then v_chat.asker else v_chat.owner_id end, 'user', v_lines[k], 'he'
      from generate_series(1, cardinality(v_lines)) k
     order by k;
    update public.chat_members m
       set last_read_at = (select c.last_message_at from public.chats c where c.id = v_chat_id)
     where m.chat_id = v_chat_id and m.user_id = v_chat.asker;
    v_created := v_created + 1;
  end loop;
  return v_created;
end;
$$;
comment on function kc_private.demo_seed_chats() is
  'Demo restore phase "chats": direct chats about demo item posts, six messages each.';
