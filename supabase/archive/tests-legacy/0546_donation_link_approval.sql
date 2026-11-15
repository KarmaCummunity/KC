-- supabase/tests/0546_donation_link_approval.sql | 0546 (D9): a suggested donation link goes live
-- only after a reviewer approves it. Covered: a new link waits (pending) and is visible to its
-- submitter and reviewers only; a member cannot approve their own link; approve and reject by
-- a reviewer, with the note kept on rejection; only pending links can be decided; a non-reviewer
-- cannot list or decide; editing an approved link sends it back to review. Reads and writes the
-- policies guard run as `authenticated`.

begin;

create temp table personas as
select kc_test.create_user('links_submitter') as submitter,
       kc_test.create_user('links_member') as member,
       kc_test.create_user('links_moderator') as moderator;
insert into public.admin_role_grants (user_id, role) select moderator, 'moderator' from personas;
grant select on personas to authenticated;

-- Runs one statement as a member with RLS enforced; returns the error text, or null.
create function pg_temp.try_as(p_user uuid, p_sql text)
returns text language plpgsql as $$
declare v_error text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    execute p_sql;
  exception when others then
    v_error := sqlerrm;
  end;
  reset role;
  return v_error;
end $$;

-- How many rows a statement returns for a member, with RLS enforced.
create function pg_temp.count_as(p_user uuid, p_sql text)
returns bigint language plpgsql as $$
declare v_count bigint;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute format('select count(*) from (%s) q', p_sql) into v_count;
  reset role;
  return v_count;
end $$;

-- A suggestion as the Edge Function writes it (service role), asking for 'approved' on purpose.
create function pg_temp.suggest(p_title text)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.donation_links (category_slug, url, display_name, submitted_by, validated_at, review_status)
  values ('food', 'https://example.org/' || md5(p_title), p_title, (select submitter from personas), now(), 'approved')
  returning id into v;
  return v;
end $$;

do $$
declare
  p personas;
  v uuid;
  v_sql text;
begin
  select * into p from personas;
  v := pg_temp.suggest('Food bank');
  v_sql := format('select 1 from public.donation_links where id = %L', v);

  perform kc_test.assert_eq((select review_status from public.donation_links where id = v), 'pending',
    'a new suggestion waits for review, whatever the writer asked for');
  perform kc_test.assert_eq(pg_temp.count_as(p.member, v_sql), 0::bigint, 'another member does not see it yet');
  perform kc_test.assert_eq(pg_temp.count_as(p.submitter, v_sql), 1::bigint, 'its submitter does');
  perform kc_test.assert_eq(pg_temp.count_as(p.moderator, v_sql), 1::bigint, 'a reviewer does');

  perform kc_test.assert_true(
    pg_temp.try_as(p.submitter, format('update public.donation_links set review_status = %L where id = %L', 'approved', v))
      like '%donation_link_review_forbidden%',
    'the submitter cannot approve their own link');

  perform kc_test.act_as(p.member);
  perform kc_test.assert_raises('select * from public.admin_list_donation_links_for_review()', 'forbidden',
    'a member cannot see the review queue');
  perform kc_test.assert_raises(format('select public.admin_review_donation_link(%L, true)', v), 'forbidden',
    'nor decide a link');

  perform kc_test.act_as(p.moderator);
  perform kc_test.assert_true(
    exists (select 1 from public.admin_list_donation_links_for_review() where id = v),
    'the link is in the reviewer''s queue');
  perform kc_test.assert_eq(public.admin_review_donation_link(v, true), 'approved', 'the reviewer approves it');
  perform kc_test.assert_eq(pg_temp.count_as(p.member, v_sql), 1::bigint, 'now every member sees it');
  perform kc_test.act_as(p.moderator); -- count_as switched the session to the member
  perform kc_test.assert_raises(format('select public.admin_review_donation_link(%L, false)', v),
    'donation_link_not_pending', 'a decided link cannot be decided again');

  -- New content needs a new review: the Edge Function's edit path, then a direct client edit.
  update public.donation_links set url = 'https://example.org/moved' where id = v;
  perform kc_test.assert_eq((select review_status from public.donation_links where id = v), 'pending',
    'editing the address sends the link back to review');
  perform kc_test.assert_eq(pg_temp.count_as(p.member, v_sql), 0::bigint, 'and hides it until then');
end $$;

do $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;
  v := pg_temp.suggest('Unknown site');
  perform kc_test.act_as(p.moderator);
  perform kc_test.assert_eq(public.admin_review_donation_link(v, false, '  not a registered org  '), 'rejected',
    'the reviewer rejects it');
  perform kc_test.assert_eq((select review_note from public.donation_links where id = v), 'not a registered org',
    'with the trimmed note');
  perform kc_test.assert_eq(
    pg_temp.count_as(p.submitter, format('select 1 from public.donation_links where id = %L and review_status = %L', v, 'rejected')),
    1::bigint, 'the submitter sees the rejection');
  perform kc_test.assert_eq(
    pg_temp.count_as(p.member, format('select 1 from public.donation_links where id = %L', v)), 0::bigint,
    'others never see a rejected link');
  perform kc_test.act_as(p.moderator); -- count_as switched the session to the member
  perform kc_test.assert_true(
    exists (select 1 from public.admin_list_donation_links_for_review('rejected') where id = v),
    'it is listed under rejected');
end $$;

rollback;

\echo '✓ 0546_donation_link_approval.sql passed'
