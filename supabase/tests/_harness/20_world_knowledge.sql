-- kc_test knowledge | Knowledge-world builders (G38). Compose the generic fixtures with the
-- exchange-post shapes of migrations 0701–0702 (spec docs/spec/requirements/23_knowledge.md).

-- A member who may publish in the knowledge world. p_id_verified = true gives identity level 2
-- (the consulting-hour gate, FR-KNOW-012); false leaves them verified for the world only
-- (`document`), below level 2.
create function kc_test.create_knowledge_member(p_handle text, p_id_verified boolean default true)
returns uuid
language plpgsql
as $$
declare
  v_user uuid := kc_test.create_user(p_handle);
begin
  update public.users
     set verified_at = now(),
         verification_method = case when p_id_verified then 'manual' else 'document' end
   where user_id = v_user;
  return v_user;
end;
$$;

-- `details.slots` for one-hour slots starting at each offset from now.
create function kc_test.knowledge_slots(variadic p_offsets interval[])
returns jsonb
language sql
stable
as $$
  select jsonb_agg(jsonb_build_object(
           'starts_at', to_char((now() + o) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           'ends_at', to_char((now() + o + interval '1 hour') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
         order by o)
    from unnest(p_offsets) as o;
$$;

-- Publishes a knowledge post of p_kind as p_owner_id and approves it, so other members see it
-- (knowledge posts start in moderation review today, #1037). Returns the post id.
create function kc_test.create_knowledge_post(
  p_owner_id uuid,
  p_kind text,
  p_details jsonb,
  p_title text default 'Knowledge post'
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  v_id := kc_test.create_listing(
    p_owner_id, 'knowledge', p_kind,
    case when p_kind in ('lesson_offer', 'mentoring_offer', 'consulting_hour') then 'give' else 'request' end,
    p_title, p_details, null);
  update public.posts set moderation_status = 'published' where post_id = v_id;
  return v_id;
end;
$$;

-- A published lesson offer with one-hour slots at the given offsets and p_capacity seats each.
create function kc_test.create_lesson_offer(
  p_owner_id uuid,
  p_capacity int,
  variadic p_offsets interval[]
)
returns uuid
language sql
as $$
  select kc_test.create_knowledge_post(
    p_owner_id, 'lesson_offer',
    jsonb_build_object('modality', 'video', 'capacity_per_slot', p_capacity,
                       'slots', kc_test.knowledge_slots(variadic p_offsets)),
    'Guitar for beginners');
$$;

-- The slot of a post starting the n-th soonest (1-based).
create function kc_test.knowledge_slot(p_post_id uuid, p_nth int default 1)
returns uuid
language sql
stable
as $$
  select slot_id from public.knowledge_slots
   where post_id = p_post_id and status = 'open'
   order by starts_at
   offset greatest(p_nth - 1, 0) limit 1;
$$;

-- Books one seat on p_slot_id as p_learner_id and returns the handoff id.
create function kc_test.book_knowledge_seat(p_learner_id uuid, p_slot_id uuid)
returns uuid
language plpgsql
as $$
begin
  perform kc_test.act_as(p_learner_id);
  return (public.book_knowledge_seat(p_slot_id)).handoff_id;
end;
$$;
