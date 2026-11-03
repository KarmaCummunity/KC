-- 0436: tighten EXECUTE grants on SECURITY DEFINER functions in public.
-- Does not touch any schema other than public.
--  * service-only (bot / queue / ledger / cron / trigger helpers): service_role only
--  * everything else: authenticated + service_role
--  * explicit allowlist of public-read RPCs and RLS helper predicates: also anon
-- Plus: future functions in public no longer get EXECUTE for PUBLIC by default.

do $$
declare
  r record;
  sig text;
  anon_allow text[] := array[
    -- RLS / view predicate helpers (evaluated for anon reads)
    'is_admin','is_blocked','is_chat_visible_to','is_listing_operator',
    'is_listing_visible_to','is_post_engagement_visible','is_post_visible_to',
    'is_following','is_active_member','shows_active_status','participant_closed_surface_visible',
    -- public read RPCs
    'browse_listings','search_listings','marketplace_search','search_all',
    'search_posts_page','search_users_page','ride_listings_search',
    'profile_closed_posts','profile_closed_posts_count','similar_listings',
    'get_marketplace_listing_detail','get_nonprofit_public_page','list_verified_nonprofits',
    'list_volunteer_opportunities','get_volunteer_opportunity_detail','map_listing_clusters',
    'feed_ranked_ids','get_post_translations','list_stored_countries','list_profile_listings',
    'get_public_research_questions','search_external_bodies','list_active_surveys',
    'rpc_search_suggested_queries','active_posts_count_for_viewer'
  ];
  is_service_only boolean;
  auth_before boolean;
  anon_before boolean;
begin
  for r in
    select p.oid, p.proname, p.prorettype = 'trigger'::regtype as is_trigger
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
  loop
    sig := r.oid::regprocedure::text;
    is_service_only :=
         r.is_trigger
      or r.proname like '\_%'
      or r.proname ~ '^(api_bot_|api_match_|whatsapp_|match_|scale_retention_|seed_)'
      or (r.proname like 'api_whatsapp_%' and r.proname !~ '^api_whatsapp_(admin_|my_link_status|create_link_code|unlink_me)')
      or r.proname in (
        'notifications_bump_attempt','provider_webhook_apply','payment_ledger_post_balanced',
        'merge_entities','undo_merge','refresh_feed_open_posts_mv','closure_cleanup_expired',
        'closure_cleanup_expired_with_metric','stats_recompute_personal_counters_nightly',
        'volunteer_shift_reminder_sweep','admin_task_enqueue_assigned_notification',
        'api_set_pro_entitlement','notifications_post_expiry_check','ride_listings_expire_check',
        'ride_participants_expire_stale_check','ride_food_overdue_alert','ride_templates_materialize',
        'ride_rate_prompt_fanout','users_merge_notification_preferences',
        'volunteer_enqueue_signup_notifications','post_stats_bump','suspension_expiry_lift',
        'posts_expiry_transition','notifications_backlog_check','social_rpc_capture_explain');

    -- only ever narrow access: remember what each role had before
    auth_before := has_function_privilege('authenticated', r.oid, 'execute');
    anon_before := has_function_privilege('anon', r.oid, 'execute');
    execute format('revoke execute on function %s from public, anon', sig);
    if is_service_only then
      execute format('revoke execute on function %s from authenticated', sig);
    else
      if auth_before then
        execute format('grant execute on function %s to authenticated', sig);
      end if;
      if anon_before and r.proname = any(anon_allow) then
        execute format('grant execute on function %s to anon', sig);
      end if;
    end if;
    execute format('grant execute on function %s to service_role', sig);
  end loop;
end $$;

alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
