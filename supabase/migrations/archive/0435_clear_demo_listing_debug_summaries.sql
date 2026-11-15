-- Demo seed listings on kc-dev carry internal English debug summaries
-- ("en route - kc-dev demo request (0426)") that render in the app.
-- Clear them. Matches only the seed marker, so it is a no-op elsewhere.
update public.listings
set summary = null
where summary like '% - kc-dev demo request (%)';
