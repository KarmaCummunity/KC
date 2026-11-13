-- flows/knowledge_lifecycle.sql | The knowledge world end to end (G38, #2034, FR-KNOW-003/004):
-- a giver publishes a lesson with two slots → a learner books a seat → the giver confirms → the
-- session is completed (karma both sides) → both rate → the offer expires after its last slot.

begin;

create temp table cast_ as
select kc_test.create_knowledge_member('kl_teacher') as teacher,
       kc_test.create_knowledge_member('kl_student') as student,
       null::uuid as post,
       null::uuid as handoff;

-- Stage 1: publish.
do $$
declare
  c cast_;
begin
  select * into c from cast_;
  update cast_ set post = kc_test.create_lesson_offer(c.teacher, 2, interval '1 day', interval '8 days');
  select * into c from cast_;
  perform kc_test.assert_eq((select count(*)::int from public.knowledge_slots where post_id = c.post), 2,
    'stage 1: the lesson has two bookable slots');
  perform kc_test.assert_eq(kc_test.listing_status(c.post), 'open'::text, 'stage 1: the lesson is open');
end $$;

-- Stage 2: book and confirm.
do $$
declare
  c cast_;
begin
  select * into c from cast_;
  update cast_ set handoff = kc_test.book_knowledge_seat(c.student, kc_test.knowledge_slot(c.post));
  select * into c from cast_;
  perform kc_test.assert_eq(kc_test.handoff_status(c.handoff), 'reserved'::text, 'stage 2: the booking waits');
  perform kc_test.act_as(c.teacher);
  perform public.confirm_knowledge_booking(c.handoff);
  perform kc_test.assert_eq(kc_test.handoff_status(c.handoff), 'confirmed'::text, 'stage 2: the teacher confirms');
end $$;

-- Stage 3: the session happens and is completed; both sides earn karma once.
do $$
declare
  c cast_;
  v_teacher_before int;
  v_student_before int;
begin
  select * into c from cast_;
  update public.post_handoffs
     set slot_starts_at = now() - interval '70 minutes', slot_ends_at = now() - interval '10 minutes'
   where handoff_id = c.handoff;
  select karma_points into v_teacher_before from public.users where user_id = c.teacher;
  select karma_points into v_student_before from public.users where user_id = c.student;
  perform kc_test.act_as(c.teacher);
  perform public.complete_knowledge_session(c.handoff);
  perform kc_test.assert_eq(kc_test.handoff_status(c.handoff), 'handed_over'::text, 'stage 3: completed');
  perform kc_test.assert_eq((select karma_points from public.users where user_id = c.teacher) - v_teacher_before, 10,
    'stage 3: the teacher earns 10 for an hour');
  perform kc_test.assert_eq((select karma_points from public.users where user_id = c.student) - v_student_before, 5,
    'stage 3: the student earns 5');
end $$;

-- Stage 4: both rate the session.
do $$
declare
  c cast_;
begin
  select * into c from cast_;
  perform kc_test.act_as(c.student);
  perform public.rate_giving_handoff(c.handoff, 5::smallint, 'Great lesson');
  perform kc_test.act_as(c.teacher);
  perform public.rate_giving_handoff(c.handoff, 5::smallint, null);
  perform kc_test.assert_eq((select count(*)::int from public.giving_handoff_ratings where handoff_id = c.handoff), 2,
    'stage 4: both sides rated');
end $$;

-- Stage 5: after its last slot the offer expires; the completed booking keeps its record.
do $$
declare
  c cast_;
begin
  select * into c from cast_;
  update public.posts set expires_at = now() - interval '1 minute' where post_id = c.post;
  perform kc_test.act_as_anon();
  perform public.knowledge_offers_expired_sweep();
  perform kc_test.assert_eq(kc_test.listing_status(c.post), 'expired'::text, 'stage 5: the lesson expired');
  perform kc_test.assert_eq(kc_test.handoff_status(c.handoff), 'handed_over'::text,
    'stage 5: the completed session is untouched');
end $$;

rollback;
\echo '✓ flows/knowledge_lifecycle.sql passed'
