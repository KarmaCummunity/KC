-- Handoffs · post_ratings (one two-sided rating for every post type, D15, D19)
--
-- After a handoff each member rates the other, 1 to 5 with an optional note. Members never
-- read the ratings written about them (D24); the rater reads their own rows back (M07:
-- `rated_by_me` of booking lists) and the moderation module adds the admin read. Ratings
-- feed the trust engine and the public summary on `user_stats` (end of this file).

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
  'Ratings between the two members of a handoff. Readable by the rater and by staff only (D24).';

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

-- The rater reads back what they gave, to show "rated" on a booking list or a handoff
-- (FR-RIDE-037 AC6). The ratee cannot read the row: only the aggregate below reaches them.
-- Query: ratings of one rater by handoff, served by post_ratings_once_key.
create policy post_ratings_select_rater on public.post_ratings
  for select to authenticated
  using (rater_id = (select auth.uid()));

grant select (id, handoff_id, rater_id, ratee_id, stars, comment, created_at)
  on public.post_ratings to authenticated;

-- Public summary of a member's ratings (M07, FR-RIDE-037, FR-RIDE-038 AC1-AC2): how many
-- they received and their average. It is a column of `user_stats`, so it is readable
-- exactly when the profile is. Below three ratings the average stays hidden (privacy
-- threshold, FR-RIDE-038 AC2); the count is always shown. Individual ratings stay private.
alter table public.user_stats
  add column ratings_count integer not null default 0 check (ratings_count >= 0),
  add column ratings_stars_total integer not null default 0 check (ratings_stars_total >= 0),
  add column ratings_avg numeric(2, 1) generated always as (
    case when ratings_count >= 3 then round(ratings_stars_total::numeric / ratings_count, 1) end) stored;
comment on column public.user_stats.ratings_count is 'Ratings received (M07); maintained by a trigger on post_ratings.';
comment on column public.user_stats.ratings_stars_total is 'Sum of the stars received; not readable, only the average derived from it is.';
comment on column public.user_stats.ratings_avg is 'Average stars, one decimal; null until three ratings were received (FR-RIDE-038 AC2).';

grant select (ratings_count, ratings_avg) on public.user_stats to authenticated;

-- Keeps the received-ratings summary of the ratee in step with every inserted or removed rating.
create function kc_private.post_ratings_sync_user_stats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.user_stats s
       set ratings_count = s.ratings_count + 1, ratings_stars_total = s.ratings_stars_total + new.stars
     where s.user_id = new.ratee_id;
  else
    update public.user_stats s
       set ratings_count = greatest(s.ratings_count - 1, 0),
           ratings_stars_total = greatest(s.ratings_stars_total - old.stars, 0)
     where s.user_id = old.ratee_id;
  end if;
  return null;
end;
$$;
comment on function kc_private.post_ratings_sync_user_stats() is
  'AFTER trigger on post_ratings: maintains ratings_count and ratings_stars_total of the ratee.';

create trigger post_ratings_sync_user_stats
  after insert or delete on public.post_ratings
  for each row execute function kc_private.post_ratings_sync_user_stats();
