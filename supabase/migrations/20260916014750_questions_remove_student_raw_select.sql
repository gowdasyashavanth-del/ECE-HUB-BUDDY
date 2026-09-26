-- SECURITY FIX (found during Phase 16G final audit, item 3): questions_select
-- granted enrolled students row-level SELECT on the full questions row,
-- including correct_answer (and any explanation column). Row-level
-- security cannot hide individual columns, so any enrolled student could
-- bypass the "safe" get_test_questions() RPC entirely with a direct
-- `select correct_answer from questions where id = ...` — confirmed live
-- with a real student account before this fix.
-- get_test_questions() is SECURITY DEFINER and does not depend on
-- students having direct table access (it runs with the function
-- owner's privileges), so removing the student branch here does not
-- break question retrieval for taking a test — verified no student-
-- facing frontend code queries public.questions directly (only
-- TestManager.tsx/QuestionManager.tsx, both teacher/admin-only).
-- Admin and the subject's own teacher keep full row access (need
-- correct_answer to author/edit questions).

drop policy if exists questions_select on public.questions;

create policy questions_select on public.questions
  for select
  using (
    is_admin()
    or teacher_has_subject(get_subject_id_for_topic(topic_id))
  );
