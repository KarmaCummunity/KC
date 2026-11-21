-- Extend the EXISTING processed-outbox retention pass to terminal dispatch jobs. No new
-- cron, and no change to the old outbox deletion condition/return count. send_unknown
-- and other unresolved work stay held and visible for explicit review, just like the
-- existing unprocessed outbox policy. Account deletion cascades the recipient's jobs.
create or replace function kc_private.outbox_purge(p_keep interval)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_rows bigint;
begin
  delete from kc_private.outbox_events e
    where e.processed_at is not null and e.processed_at<now()-p_keep;
  get diagnostics v_rows=row_count;
  delete from kc_private.dispatch_jobs j where j.finished_at is not null and j.finished_at<now()-p_keep;
  delete from kc_private.dispatch_admissions a where not exists(
    select 1 from kc_private.outbox_events e where e.id=a.origin_event_id)
    and not exists(select 1 from kc_private.dispatch_jobs j where j.origin_event_id=a.origin_event_id);
  return v_rows;
end;
$$;
