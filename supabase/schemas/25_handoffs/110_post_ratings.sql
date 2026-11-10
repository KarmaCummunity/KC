-- Handoffs · post_ratings (one two-sided rating for every post type, D15, D19)
--
-- After a handoff each member rates the other, 1 to 5 with an optional note. Members never
-- see ratings — not the ones about them and not their own (D24): the table has no policy
-- and no grant for a device, and the moderation module adds the admin read. Ratings feed
-- the trust engine.

create table public.post_ratings (
  id         uuid primary key default gen_random_uuid(),
  -- Kept (as null) when the handoff goes with a deleted post or account, so the rating of
  -- the remaining member survives (design §4.1).
  handoff_id uuid references public.post_handoffs (id) on delete set null,
  -- Null once the rater's account is purged.
  rater_id   uuid references public.users (id) on delete set null,
  ratee_id   uuid not null references public.users (id) on delete cascade,
  stars      smallint not null check (stars between 1 and 5),
  comment    text check (char_length(comment) between 1 and 500),
  created_at timestamptz not null default now(),
  constraint post_ratings_distinct_members_chk check (rater_id <> ratee_id),
  -- Each member rates a handoff once; also covers the handoff foreign key.
  constraint post_ratings_once_key unique (handoff_id, rater_id)
);
comment on table public.post_ratings is
  'Ratings between the two members of a handoff. Not readable by members (D24).';

-- A member's ratings for the trust engine and the admin view, newest first; covers ratee_id.
create index post_ratings_ratee_recent_idx on public.post_ratings (ratee_id, created_at desc, id desc);
-- Covers the rater foreign key (account purge).
create index post_ratings_rater_idx on public.post_ratings (rater_id) where rater_id is not null;

alter table public.post_ratings enable row level security;
alter table public.post_ratings force row level security;

-- Rates the other member of a handoff the caller took part in.
--   invalid_rating          stars outside 1–5, or a note longer than 500 characters
--   handoff_not_found       no such handoff, or it was not handed over
--   not_participant         the caller is not one of its two members
--   handoff_already_rated   the caller already rated it; a rating is final, since its
--                           author cannot read it back
-- The spec sets no time limit for rating. A `karma` event rewards the rater once.
create function public.rate_handoff(p_handoff_id uuid, p_stars integer, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_comment constant text := nullif(btrim(p_comment), '');
  v_handoff public.post_handoffs;
begin
  if p_stars is null or p_stars not between 1 and 5 or char_length(v_comment) > 500 then
    raise exception 'invalid_rating' using errcode = 'P0001';
  end if;
  select h.* into v_handoff from public.post_handoffs h
   where h.id = p_handoff_id and h.status = 'handed_over';
  if not found then
    raise exception 'handoff_not_found' using errcode = 'P0001';
  end if;
  if v_user_id not in (v_handoff.owner_id, v_handoff.recipient_id) then
    raise exception 'not_participant' using errcode = 'P0001';
  end if;

  insert into public.post_ratings (handoff_id, rater_id, ratee_id, stars, comment)
  values (p_handoff_id, v_user_id,
          case v_user_id when v_handoff.owner_id then v_handoff.recipient_id else v_handoff.owner_id end,
          p_stars, v_comment)
  on conflict (handoff_id, rater_id) do nothing;
  if not found then
    raise exception 'handoff_already_rated' using errcode = 'P0001';
  end if;

  perform kc_private.outbox_enqueue('karma', jsonb_build_object(
    'kind', 'rating_given', 'handoff_id', p_handoff_id, 'post_id', v_handoff.post_id,
    'rater_id', v_user_id));
end;
$$;
comment on function public.rate_handoff(uuid, integer, text) is
  'The caller rates the other member of a handed-over handoff, once.';
grant execute on function public.rate_handoff(uuid, integer, text) to authenticated;
