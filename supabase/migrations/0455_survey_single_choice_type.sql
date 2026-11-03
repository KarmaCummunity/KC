-- 0455_survey_single_choice_type | KC#1058 — single-choice survey questions (Sean Ellis PMF survey).
--
-- Adds the `single_choice_with_optional_text` value to `survey_question_type`.
-- It lives in its own migration because Postgres cannot use an enum value in the
-- same transaction that adds it; 0456 / 0457 use it.

alter type public.survey_question_type add value if not exists 'single_choice_with_optional_text';
