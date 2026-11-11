-- 0744_create_post_with_media_idempotency.sql
-- ADR-004: client postId idempotency support in create_post_with_media (#1999)

begin;

create or replace function public.create_post_with_media(
  p_post jsonb,
  p_media jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_post_id uuid;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  if p_post is null or jsonb_typeof(p_post) <> 'object' then
    raise exception 'invalid_post_payload' using errcode = '22023';
  end if;
  if p_media is not null and jsonb_typeof(p_media) <> 'array' then
    raise exception 'invalid_media_payload' using errcode = '22023';
  end if;

  -- Idempotency check: if client supplied a post_id and it already exists, return it
  if (p_post->>'post_id') is not null then
    select post_id into v_post_id
      from public.posts
     where post_id = (p_post->>'post_id')::uuid
       and owner_id = v_uid;
    if v_post_id is not null then
      return v_post_id;
    end if;
  end if;

  insert into public.posts (
    post_id, owner_id, type, visibility, title, description, category, city, street, street_number,
    location_display_level, item_condition, urgency, estimated_value
  )
  select coalesce((p_post->>'post_id')::uuid, gen_random_uuid()), v_uid, r.type, r.visibility,
         r.title, r.description, r.category, r.city, r.street, r.street_number,
         r.location_display_level, r.item_condition, r.urgency, r.estimated_value
    from jsonb_populate_record(null::public.posts, p_post) r
  returning post_id into v_post_id;

  -- Photos keep the order the client sent; `ordinal` is the array position (0-based).
  insert into public.media_assets (post_id, ordinal, path, mime_type, size_bytes)
  select v_post_id, (m.ord - 1)::smallint, m.item ->> 'path', m.item ->> 'mime_type',
         (m.item ->> 'size_bytes')::integer
    from jsonb_array_elements(coalesce(p_media, '[]'::jsonb)) with ordinality as m(item, ord);

  return v_post_id;
end;
$$;

comment on function public.create_post_with_media(jsonb, jsonb) is
  'KC#2020, #1999: items post engine create with client postId idempotency support.';

revoke all on function public.create_post_with_media(jsonb, jsonb) from public, anon;
grant execute on function public.create_post_with_media(jsonb, jsonb) to authenticated;

commit;
