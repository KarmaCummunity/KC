-- 0536 | Assert each audited FK and hot-path index is present.

\set ON_ERROR_STOP on

do $$
declare
  v_name text;
begin
  foreach v_name in array array[
    'giving_handoffs_listing_fk_idx',
    'survey_answers_survey_fk_idx',
    'survey_answers_question_fk_idx',
    'ride_route_alerts_user_status_delivered_idx',
    'ride_route_alerts_pending_created_idx',
    'ride_route_alerts_listing_fk_idx',
    'ride_listing_emergencies_triggered_by_fk_idx',
    'ride_listing_emergencies_resolved_by_fk_idx',
    'ride_series_kind_fk_idx'
  ] loop
    if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = v_name) then
      raise exception 'missing index %', v_name;
    end if;
  end loop;
end $$;

\echo '0536_fk_and_hot_path_indexes.sql passed'
