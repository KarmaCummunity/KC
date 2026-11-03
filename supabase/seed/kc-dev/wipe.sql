-- Remove all KC dev seed data (seed users cascade to posts, rides, chats, follows…, plus the
-- [DEMO] nonprofits). DEV ONLY. Same function the Admin Portal "Demo data" screen uses (0591).
do $$ begin
  if coalesce(current_setting('kc.seed_target', true), '') <> 'dev' then
    raise exception 'refusing to wipe: set kc.seed_target=dev';
  end if;
end $$;
select public.kc_dev_wipe_demo_data() as wiped;
