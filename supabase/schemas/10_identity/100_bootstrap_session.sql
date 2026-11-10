-- Identity · bootstrap_session (docs/db/target-design.md §5 "Session start")
--
-- Everything the app needs to decide what to show after sign-in, in one round trip: the
-- account gate, the caller's private profile and the legal consent prompt. Each later module
-- adds its own top-level key (unread counts, admin roles, survey prompts); existing keys
-- never change shape.
--
-- It runs with the caller's rights: every row it reads is one the caller may already select.

create function public.bootstrap_session()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user_id constant uuid := (select auth.uid());
  v_result jsonb;
begin
  select jsonb_build_object(
           'user_id', a.user_id,
           -- Account gate: `status` other than active sends the app to the matching screen.
           'account', jsonb_build_object(
             'status', a.status,
             'status_until', a.status_until,
             'onboarding_state', a.onboarding_state,
             'deletion_requested_at', a.deletion_requested_at,
             'deletion_purge_at', a.deletion_purge_at),
           'private_profile', jsonb_build_object(
             'contact_phone', p.contact_phone,
             'date_of_birth', p.date_of_birth,
             'profile_street', p.profile_street,
             'profile_street_number', p.profile_street_number,
             'notification_preferences', p.notification_preferences,
             'show_active_status', p.show_active_status,
             'closure_explainer_dismissed', p.closure_explainer_dismissed,
             'first_post_nudge_dismissed', p.first_post_nudge_dismissed,
             'basic_info_skipped', p.basic_info_skipped),
           -- ↓ Added by the messaging and notifications modules: the two badges of the top bar
           -- (FR-CHAT-012, spec 07 §7.11). Both functions are created by those modules.
           'unread', jsonb_build_object(
             'chats', public.chat_unread_total(),
             'notifications', public.notifications_unread_count()),
           -- ↑ End of the messaging and notifications addition.
           'legal', (
             -- Documents in force whose last material version the caller has not accepted.
             -- `modal` blocks the app; `banner` is the 7-day notice of a standard change,
             -- measured on the database clock (FR-SETTINGS-010 AC3, AC5).
             select jsonb_build_object(
                      'needs_reacknowledgement', count(*) > 0,
                      'blocking', coalesce(bool_or(o.block_mode = 'modal'), false),
                      'documents', coalesce(jsonb_agg(to_jsonb(o) order by o.doc_type), '[]'::jsonb))
               from (
                 select d.doc_type, d.current_version, d.current_effective_date,
                        d.last_material_version, d.last_material_severity,
                        coalesce(c.version, 0) as last_accepted_version,
                        case
                          when d.last_material_severity = 'critical'
                            or now() - d.current_effective_date >= interval '7 days' then 'modal'
                          else 'banner'
                        end as block_mode
                   from public.legal_documents d
                   left join lateral (
                     select max(uc.version) as version
                       from public.user_consents uc
                      where uc.user_id = a.user_id and uc.consent_kind = d.doc_type) c on true
                  where d.current_effective_date <= now()
                    and coalesce(c.version, 0) < d.last_material_version) o))
    into v_result
    from public.user_account a
    join public.user_private p on p.user_id = a.user_id
   where a.user_id = v_user_id;

  if v_result is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  return v_result;
end;
$$;
comment on function public.bootstrap_session() is
  'Session start in one call: account gate, private profile, unread badges, legal consent prompt.';
grant execute on function public.bootstrap_session() to authenticated;
