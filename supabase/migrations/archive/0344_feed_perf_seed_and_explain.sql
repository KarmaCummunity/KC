-- 0344_feed_perf_seed_and_explain | KC#899 — seeded load + EXPLAIN capture for CI/pgTAP.

begin;

create or replace function public.seed_feed_performance_posts(
  p_owner_id uuid,
  p_city_id text,
  p_count integer default 800
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer := greatest(coalesce(p_count, 800), 1);
  v_i integer;
begin
  if p_owner_id is null or p_city_id is null then
    raise exception 'owner_and_city_required' using errcode = '22023';
  end if;

  for v_i in 1..v_n loop
    insert into public.posts (
      owner_id, type, status, visibility, title, description, category,
      city, street, street_number, item_condition
    )
    values (
      p_owner_id,
      case when v_i % 2 = 0 then 'Give' else 'Request' end,
      'open',
      'Public',
      'Perf seed post ' || v_i::text,
      'KC899 load test row',
      'Other',
      p_city_id,
      'Seed Street',
      '1',
      case when v_i % 2 = 0 then 'Good' else null end
    );
  end loop;

  perform public.refresh_feed_open_posts_mv(false);
  return v_n;
end;
$$;

create or replace function public.feed_newest_explain_analyze_ms(
  p_viewer_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_plan jsonb;
  v_ms double precision;
  v_t0 timestamptz;
begin
  v_t0 := clock_timestamp();
  perform count(*) from public.feed_ranked_ids(
    p_viewer_id, null, null, null, 'open', null, null,
    'newest', null, 20, null, null, null, null, false, null
  );
  v_ms := extract(epoch from (clock_timestamp() - v_t0)) * 1000.0;

  execute $q$
    explain (analyze, buffers, format json)
    select * from public.feed_ranked_ids(
      $1, null, null, null, 'open', null, null,
      'newest', null, 20, null, null, null, null, false, null
    )
  $q$
  into v_plan
  using p_viewer_id;

  return jsonb_build_object(
    'elapsed_ms', round(v_ms::numeric, 3),
    'explain_json', v_plan,
    'mv_row_count', (select row_count from public.feed_mv_refresh_state where singleton_id = 1)
  );
end;
$$;

revoke all on function public.seed_feed_performance_posts(uuid, text, integer) from public, authenticated, anon;
revoke all on function public.feed_newest_explain_analyze_ms(uuid) from public, authenticated, anon;
grant execute on function public.seed_feed_performance_posts(uuid, text, integer) to service_role;
grant execute on function public.feed_newest_explain_analyze_ms(uuid) to service_role;

commit;
