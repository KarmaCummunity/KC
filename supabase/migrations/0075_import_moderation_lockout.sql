-- External post import · the moderation lockout (FR-IMPORT-008 AC4, KC#2395).
--
-- A member whose imported posts were removed by moderation 3 times in 30 days loses the import
-- entry for 14 days. The removals are the `post_status_moderated` audit events (FR-MOD-*) that
-- move a post to `removed_admin`; a post is "imported" when an import record links to it
-- (`external_post_imports.post_id`, set by api_import_attach_post). The extraction function reads
-- the times through this function with the service role and decides the lock in code (limits.ts),
-- so the rule and its numbers live in one place and are unit-tested there.

-- When moderation removed the member's imported posts since the instant, oldest first. A post
-- removed, restored and removed again counts each time: every removal was a moderation decision.
create function public.import_moderation_removals(p_user_id uuid, p_since timestamptz)
returns setof timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select e.occurred_at
    from audit.events e
    join public.external_post_imports i on i.post_id = e.target_id
   where i.user_id = p_user_id
     and e.action = 'post_status_moderated'
     and e.target_type = 'post'
     and e.metadata ->> 'to' = 'removed_admin'
     and e.occurred_at >= p_since
   order by e.occurred_at;
$$;
comment on function public.import_moderation_removals(uuid, timestamptz) is
  'Times moderation removed the member''s imported posts since the instant (FR-IMPORT-008 AC4); service role only.';

-- Only the extraction function (service role) reads it: a member must not probe another member's record.
revoke all on function public.import_moderation_removals(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.import_moderation_removals(uuid, timestamptz) to service_role;
