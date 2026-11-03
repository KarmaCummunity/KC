-- 0536 | Missing FK indexes and targeted hot-path indexes found in the final-schema audit.

-- FK and booking lookups by listing_id must include inactive handoffs too.
create index if not exists giving_handoffs_listing_fk_idx on public.giving_handoffs (listing_id);

-- Survey reads/deletes join answers by survey and question independently.
create index if not exists survey_answers_survey_fk_idx on public.survey_answers (survey_id);
create index if not exists survey_answers_question_fk_idx on public.survey_answers (question_id);

-- Ride alert delivery checks per-user daily caps and sweeps pending alerts in creation order.
create index if not exists ride_route_alerts_user_status_delivered_idx on public.ride_route_alerts (user_id, status, delivered_at);
create index if not exists ride_route_alerts_pending_created_idx on public.ride_route_alerts (status, created_at) where status = 'pending';
-- FK cascade from listings and listing-specific alert delivery need a full listing_id index.
create index if not exists ride_route_alerts_listing_fk_idx on public.ride_route_alerts (listing_id);

-- Emergency visibility is keyed by the reporting user; user deletion also cascades these rows.
create index if not exists ride_listing_emergencies_triggered_by_fk_idx on public.ride_listing_emergencies (triggered_by);
create index if not exists ride_listing_emergencies_resolved_by_fk_idx on public.ride_listing_emergencies (resolved_by);

-- FK from recurring series to the selected listing kind.
create index if not exists ride_series_kind_fk_idx on public.ride_series (kind_id);
