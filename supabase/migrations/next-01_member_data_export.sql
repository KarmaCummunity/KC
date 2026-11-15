-- Identity · a member downloads a copy of their own data (right of access / portability)
--
-- `public.export_my_data()` returns one JSON document with every row the platform keeps that
-- belongs to the calling member, read with definer rights and filtered by the caller's id
-- only (`kc_private.require_caller()`): there is no parameter, so no other member's data can
-- be asked for. What is left out on purpose:
--   * derived or internal columns: search vectors, de-identification tombstones, idempotency
--     keys, provider tokens and references, hosted checkout links, push tokens;
--   * the ids of staff who acted on the member's rows (issued_by, resolved_by, reviewed_by …);
--   * other members' content: only the messages the member sent are included, and ratings
--     the member received come without the rater.
-- Geography columns are returned as GeoJSON. A member may export a few times an hour
-- (`kc_private.rate_limits` row `data_export`).

insert into kc_private.rate_limits (action, max_count, "window", description) values
  ('data_export', 5, interval '1 hour', 'Self-service data exports. Enforced in public.export_my_data.')
on conflict (action) do nothing;

-- The rows of one query as a JSON array ([] when none); the query is fixed SQL text below.
create function kc_private.export_rows(p_sql text, p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  execute format('select coalesce(jsonb_agg(to_jsonb(r)), ''[]''::jsonb) from (%s) r', p_sql)
    into v_out using p_user_id;
  return v_out;
end;
$$;
comment on function kc_private.export_rows(text, uuid) is
  'Helper of public.export_my_data: runs one fixed query with the member id as $1 and returns its rows as a JSON array.';
revoke all on function kc_private.export_rows(text, uuid) from public, anon, authenticated;

create function public.export_my_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid constant uuid := kc_private.require_caller();
  v jsonb := '{}'::jsonb;
  s record;
begin
  perform kc_private.rate_limit_enforce('data_export', v_uid);

  for s in select * from (values
    -- account and profile
    ('account', $q$select u.email, u.phone, u.created_at, u.email_confirmed_at,
        u.raw_app_meta_data -> 'providers' as sign_in_providers
        from auth.users u where u.id = $1$q$),
    ('profile', $q$select to_jsonb(u) - 'search_vector' as row from public.users u where u.id = $1$q$),
    ('private_details', $q$select p.* from public.user_private p where p.user_id = $1$q$),
    ('account_status', $q$select a.* from public.user_account a where a.user_id = $1$q$),
    ('profile_fields', $q$select f.* from public.user_profile_fields f where f.user_id = $1$q$),
    ('stats', $q$select s.* from public.user_stats s where s.user_id = $1$q$),
    ('consents', $q$select c.consent_kind, c.version, c.accepted_at, c.locale, c.ip_address, c.user_agent
        from public.user_consents c where c.user_id = $1 order by c.accepted_at$q$),
    ('devices', $q$select d.platform, d.created_at, d.last_seen_at from public.user_devices d where d.user_id = $1$q$),
    ('feedback', $q$select f.rating, f.body, f.created_at from public.user_feedback f where f.user_id = $1$q$),
    ('sanctions', $q$select x.kind, x.reason, x.note, x.issued_at, x.until, x.lifted_at
        from public.user_sanctions x where x.user_id = $1$q$),
    ('roles', $q$select g.role, g.scope_org_id, g.is_platform, g.granted_at, g.revoked_at
        from public.admin_role_grants g where g.user_id = $1$q$),
    ('active_days', $q$select d.active_on from kc_private.user_active_days d where d.user_id = $1 order by 1$q$),
    -- posts and what hangs on them
    ('posts', $q$select to_jsonb(p) - 'search_vector' - 'geo_approx'
        || jsonb_build_object('geo_approx', extensions.st_asgeojson(p.geo_approx)::jsonb) as row
        from public.posts p where p.owner_id = $1 order by p.created_at$q$),
    ('post_media', $q$select m.* from public.post_media m where m.owner_id = $1$q$),
    ('post_identity_settings', $q$select a.* from public.post_actor_identity a where a.user_id = $1$q$),
    ('post_series', $q$select x.* from public.post_series x where x.owner_id = $1$q$),
    ('ride_series', $q$select x.* from public.ride_series x where x.owner_id = $1$q$),
    ('comments', $q$select c.* from public.post_comments c where c.author_id = $1 order by c.created_at$q$),
    ('post_reactions', $q$select x.* from public.post_reactions x where x.user_id = $1$q$),
    ('comment_reactions', $q$select x.* from public.post_comment_reactions x where x.user_id = $1$q$),
    ('shares', $q$select x.* from public.post_shares x where x.user_id = $1$q$),
    ('saved_posts', $q$select x.* from public.saved_posts x where x.user_id = $1$q$),
    ('hidden_posts', $q$select x.* from public.feed_hides x where x.user_id = $1$q$),
    ('feed_filters', $q$select x.* from public.feed_mute_filters x where x.user_id = $1$q$),
    ('handoffs', $q$select h.* from public.post_handoffs h where $1 in (h.owner_id, h.recipient_id)$q$),
    ('ratings_given', $q$select x.* from public.post_ratings x where x.rater_id = $1$q$),
    ('ratings_received', $q$select x.handoff_id, x.stars, x.comment, x.created_at
        from public.post_ratings x where x.ratee_id = $1$q$),
    ('emergency_reports', $q$select e.id, e.post_id, e.note, extensions.st_asgeojson(e.location)::jsonb as location,
        e.created_at from public.post_emergencies e where e.reporter_id = $1$q$),
    ('saved_ride_routes', $q$select to_jsonb(x) - 'origin_point' - 'dest_point' || jsonb_build_object(
          'origin_point', extensions.st_asgeojson(x.origin_point)::jsonb,
          'dest_point', extensions.st_asgeojson(x.dest_point)::jsonb) as row
        from public.ride_saved_routes x where x.user_id = $1$q$),
    ('ride_route_alerts', $q$select x.* from public.ride_route_alerts x where x.user_id = $1$q$),
    -- people and messages
    ('following', $q$select f.followed_id, f.created_at from public.follows f where f.follower_id = $1$q$),
    ('followers', $q$select f.follower_id, f.created_at from public.follows f where f.followed_id = $1$q$),
    ('follow_requests', $q$select r.* from public.follow_requests r where $1 in (r.requester_id, r.target_id)$q$),
    ('blocks', $q$select b.blocked_id, b.created_at from public.blocks b where b.blocker_id = $1$q$),
    ('chats', $q$select m.* from public.chat_members m where m.user_id = $1$q$),
    ('messages_sent', $q$select m.* from public.messages m where m.sender_id = $1 order by m.created_at$q$),
    ('message_reactions', $q$select x.* from public.message_reactions x where x.user_id = $1$q$),
    ('reports_filed', $q$select x.id, x.target_type, x.target_id, x.reason, x.note, x.status, x.resolved_at, x.created_at
        from public.reports x where x.reporter_id = $1$q$),
    ('notifications', $q$select n.* from public.notifications n where n.user_id = $1 order by n.created_at desc$q$),
    -- participation
    ('karma', $q$select k.* from public.karma_ledger k where k.user_id = $1 order by k.created_at$q$),
    ('challenges', $q$select x.* from public.challenge_participations x where x.user_id = $1$q$),
    ('challenge_progress', $q$select x.* from public.challenge_progress_entries x where x.user_id = $1$q$),
    ('survey_answers', $q$select x.* from public.survey_answers x where x.user_id = $1$q$),
    ('org_memberships', $q$select x.* from public.org_memberships x where x.user_id = $1$q$),
    ('org_applications', $q$select to_jsonb(x) - 'reviewed_by' as row from public.org_applications x where x.applicant_id = $1$q$),
    ('suggested_links', $q$select to_jsonb(x) - 'search_vector' - 'reviewed_by' as row
        from public.donation_links x where x.submitted_by = $1$q$),
    ('timesheets', $q$select to_jsonb(x) - 'approved_by' as row from kc_private.timesheet_entries x where x.user_id = $1$q$),
    -- money (amounts in agorot)
    ('subscriptions', $q$select x.* from billing.user_entitlements x where x.user_id = $1$q$),
    ('donation_intents', $q$select x.id, x.org_id, x.post_id, x.standing_order_id, x.amount_agorot, x.currency,
        x.status, x.created_at, x.updated_at from billing.donation_intents x where x.user_id = $1$q$),
    ('payments', $q$select x.id, x.intent_id, x.org_id, x.amount_agorot, x.currency, x.status, x.refunded_agorot,
        x.created_at from billing.payments x where x.user_id = $1$q$),
    ('receipts', $q$select x.id, x.org_id, x.serial, x.payment_id, x.amount_agorot, x.currency, x.sec46_eligible,
        x.issued_at from billing.receipts x where x.user_id = $1$q$),
    ('standing_orders', $q$select x.id, x.org_id, x.amount_agorot, x.currency, x.cadence, x.status, x.next_charge_at,
        x.cancelled_at, x.created_at from billing.standing_orders x where x.user_id = $1$q$),
    ('payment_methods', $q$select x.id, x.last4, x.brand, x.is_default, x.created_at
        from billing.payment_methods x where x.user_id = $1$q$),
    ('identity_verification', $q$select x.status, x.verified_at, x.updated_at from billing.kyc_profiles x where x.user_id = $1$q$),
    -- WhatsApp channel
    ('whatsapp_identity', $q$select x.wa_id, x.consent_status, x.consent_updated_at, x.last_inbound_at, x.preferred_language,
        x.created_at from integrations.whatsapp_identities x where x.user_id = $1$q$),
    ('whatsapp_consents', $q$select x.* from integrations.whatsapp_consents x where x.user_id = $1$q$),
    ('whatsapp_consent_events', $q$select x.action, x.source, x.keyword, x.created_at
        from integrations.whatsapp_consent_events x where x.user_id = $1$q$),
    ('whatsapp_messages_to_member', $q$select x.kind, x.language, x.body, x.status, x.sent_at, x.created_at
        from integrations.whatsapp_outbound_messages x where x.user_id = $1$q$)
  ) as t (section, query)
  loop
    -- Queries that select `to_jsonb(...) as row` are unwrapped, the others are taken as they are.
    v := v || jsonb_build_object(s.section, (
      select coalesce(jsonb_agg(case when e ? 'row' and (select count(*) from jsonb_object_keys(e)) = 1
                                     then e -> 'row' else e end), '[]'::jsonb)
        from jsonb_array_elements(kc_private.export_rows(s.query, v_uid)) e));
  end loop;

  return jsonb_build_object(
    'format', 'kc-member-export/1',
    'generated_at', now(),
    'user_id', v_uid,
    'data', v);
end;
$$;
comment on function public.export_my_data() is
  'A copy of every row kept about the calling member (right of access / portability), as one JSON document. Own data only; rate limited.';
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
