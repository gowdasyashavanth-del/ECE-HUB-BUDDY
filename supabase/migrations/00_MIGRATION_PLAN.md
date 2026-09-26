# ECE Hub Buddy — Migration Structure & Execution Order

Design/SQL only. **Not executed. No Supabase project created or connected. Bioverse untouched.** Run these, in order, against a fresh ECE Hub Buddy Supabase project only once you've reviewed and approved them.

## Why this ordering

Postgres foreign keys mean dependent tables must be created after what they reference. The order below resolves that, and also separates **schema** (tables) from **security** (functions, triggers, RLS) into distinct files — same convention Bioverse used, kept because it makes each migration independently reviewable and the dependency chain visible at a glance:

| # | File | Contains | Depends on |
|---|---|---|---|
| 1 | `01_extensions_and_helpers.sql` | `pgcrypto`, `set_updated_at()` | nothing |
| 2 | `02_users_and_profiles.sql` | `users`, signup trigger | `auth.users` (built-in) |
| 3 | `03_academic_hierarchy.sql` | years → regulations → programs → semesters → sections → subjects → units → topics → content | `users` (content.uploaded_by) |
| 4 | `04_assignments_enrollments.sql` | `student_assignments`, `teacher_assignments` | `users`, academic hierarchy |
| 5 | `05_learning_content.sql` | `formulas`, `questions`, `tests`, `results` | academic hierarchy, `users` |
| 6 | `06_engagement_and_progress.sql` | `announcements`, `reels` (+bookmarks/history), `progress`, `achievements` (+student_achievements) | academic hierarchy, `users` |
| 7 | `07_virtual_lab_schema.sql` | component catalog, `experiments` (+required components/questions), `student_circuits`, `experiment_attempts` | academic hierarchy (topics), `users` |
| 8 | `08_security_functions.sql` | `current_role()`, `is_admin()`, `is_teacher_or_admin()`, `teacher_has_subject()`, `student_enrolled_in_subject()`, `get_subject_id_for_topic()` | every table above (functions query them) |
| 9 | `09_protected_columns_triggers.sql` | column-lock triggers on `users` and `experiment_attempts` | step 8 (triggers call `is_admin()`) |
| 10 | `10_rls_core.sql` | RLS: academic hierarchy, `users`, assignments | step 8 |
| 11 | `11_rls_learning_and_engagement.sql` | RLS: formulas/questions/tests/results/announcements/reels/progress/achievements | step 8 |
| 12 | `12_rls_virtual_lab.sql` | RLS: all lab tables | step 8 |
| 13 | `13_storage.sql` | buckets + storage policies | step 8 |

All files are written idempotently (`create table if not exists`, `drop policy if exists` before `create policy`, `create or replace function`) so re-running any file is safe, matching the convention Bioverse already used.

## What's deliberately NOT in here

Per your lock-in: no `branches` table, no `payments`/`subscriptions`, no `exam_type`/KCET/NEET fields, no `1st PU`/`2nd PU` constraints, no `attempt_measurements` time-series table (deferred), no per-component-instance tables (circuits store components/wires as embedded JSON). Also not included, because they weren't in your 25-item list and nothing in this design needs them yet: `audit_log`, `platform_settings`, `notifications`, `community_posts/replies`. These were fine patterns in Bioverse and could be ported later exactly as-is if you want them, but adding them now would be scope creep beyond what you asked for.

## One addition beyond your literal list, flagged for your review

You listed "Quizzes/questions" (item 11) but not a results/scoring table. I added `results` (§05) to record a student's score per test — without it, `tests`/`questions` have no way to actually record an outcome, which seems like an oversight rather than an intentional omission. Same reasoning for `student_achievements` (a join table recording which student unlocked which catalog achievement) alongside `achievements` (item 17) — a catalog with nothing tracking who's unlocked what isn't functional. Flagging both so you can strike them if that's not what you meant.

## Review checklist before you approve execution

- [ ] Confirm the `content.type` check list (`'video','note','formula_sheet','link','document'`) covers what you need.
- [ ] Confirm `tests` may be scoped to either a subject or a topic (not both) — reflects that engineering tests are sometimes subject-wide, not always topic-specific.
- [ ] Confirm `announcements.scope_type` (`'all' | 'section' | 'subject'`) is the right scoping granularity.
- [ ] Confirm the experiment-grading trust boundary in §4 of the Virtual Lab design (service-role Edge Function is the only writer of `score`/`xp_earned`/`validation_result`/`completion_status`) matches what you intend to build server-side.

SQL follows in the 13 files below.
