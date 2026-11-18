-- Post cards say where an imported post came from (FR-IMPORT-007 AC3, KC#2427).
--
-- `api_import_attach_post` marks a post published from an import draft as `source = 'imported'`
-- with the platform the member named (`source_platform`), but no read carried them to the app, so
-- the card and the detail could not show the "from WhatsApp / Facebook / Yad2" chip.
--
-- Nothing new is exposed: `post_cards` runs with the caller's rights, so both columns come from
-- `posts` under the same row-level security the rest of the card has. The platform is a label the
-- member chose, never a link or a group name. Every page function returns the whole `post_cards`
-- row (`select c, ...`), so they carry the new attributes without being redefined (as in 0061).

alter type public.post_card
  add attribute source          text,
  add attribute source_platform text;

comment on type public.post_card is 'Everything a post card shows, as returned by every post list.';

create or replace function public.post_cards(p_post_ids uuid[])
returns setof public.post_card
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, case when mk.masked then null else p.owner_id end, p.world_slug, p.kind_id, p.post_type, p.direction, p.status, p.visibility,
         p.title, p.description, p.item_subcategory_id, p.details,
         p.city_id, c.name_he, c.name_en, p.location_display_level, p.time_window, p.urgency_level,
         p.expires_at, p.published_at, p.created_at,
         case when mk.masked then null else u.display_name end,
         case when mk.masked then null else u.share_handle end,
         case when mk.masked then null else u.avatar_url end,
         case when mk.masked then null else u.verification_level end,
         media.cover, coalesce(media.n, 0),
         coalesce(s.reactions_count, 0), coalesce(s.comments_count, 0), coalesce(s.shares_count, 0),
         (select r.reaction_type from public.post_reactions r
           where r.post_id = p.id and r.user_id = (select auth.uid())),
         exists (select 1 from public.saved_posts sp
                  where sp.user_id = (select auth.uid()) and sp.post_id = p.id),
         exists (select 1 from public.follows f
                  where f.follower_id = (select auth.uid()) and f.followed_id = p.owner_id)
           and not mk.masked,
         mk.masked,
         -- What a card needs besides the facts above, so a page is one round trip (NFR-PERF-005).
         -- `geo_approx` is text: the same hex EWKB string a direct read of the column returns.
         p.geo_approx::text, p.source_language, p.status_before_removal,
         p.shown_street, p.shown_street_number,
         (select ch.id from public.challenges ch where ch.post_id = p.id),
         -- Provenance (FR-IMPORT-007 AC3): 'imported' with the platform the member named, for the chip.
         p.source, p.source_platform
    from public.posts p
    cross join lateral (select kc_access.post_actor_masked(p.id, p.owner_id) as masked) mk
    join public.users u on u.id = p.owner_id
    join public.cities c on c.city_id = p.city_id
    left join public.post_stats s on s.post_id = p.id
    left join lateral (
      select count(*)::integer as n,
             (array_agg(kc_access.post_media_json(m) order by m.ordinal))[1] as cover
        from public.post_media m
       where m.post_id = p.id and m.processing_status = 'ready') media on true
   where p.id = any (p_post_ids[1:100]);
$$;

comment on function public.post_cards(uuid[]) is 'Cards of the listed posts that the caller can read.';
