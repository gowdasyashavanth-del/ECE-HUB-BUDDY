# ECE Hub Buddy — Database and Migration Reference

> **Source baseline:** GitHub `main` @ `6d557533a7c26da3fc668ae7e6d1233148129e4c`.
> **Tags:** **[V]** verified in tracked source · **[O]** owner-stated · **[R]** reported by an existing untracked report, not re-verified · **[H]** historical · **[A]** assumption · **[U]** unresolved.
>
> **Method note [V]:** counts and the "final" object lists below come from a *static, in-order replay of the SQL text* of all 59 migrations (create/drop of tables, policies, triggers, functions). It does not run SQL. Objects created inside dynamic SQL (`EXECUTE`/`DO` blocks), manual dashboard changes, or production drift would not appear. The live production catalog was **not** inspected for this document.

## 1. Migration inventory

- **59 SQL files** plus `00_MIGRATION_PLAN.md` in `supabase/migrations/`. **[V]**
- Every SQL file name is `YYYYMMDDHHMMSS_<label>.sql`. Commit `a386a51` ("align legacy migration filenames with production history") gave the original `01`–`19` files timestamp prefixes. **[V]** The README sentence "numbered `01`–`19` first, then timestamped files" therefore no longer describes the directory (`05-PROJECT-STATUS-AND-KNOWN-ISSUES.md`).
- Number labels embedded in names: `01`–`15`, `15b`, `17`–`21`. **There is no label `16`.** Unlabelled files use descriptive names. **[V]**
- `00_MIGRATION_PLAN.md` has no timestamp prefix and is a historical design note (it still says "Not executed. No Supabase project created"). **[H]** How the Supabase CLI treats a non-conforming filename in that folder was not tested here. **[U]**
- There is no `supabase/seed.sql`, although `config.toml` has `[db.seed] enabled = true`. **[V]**

## 2. Migration history (exact filenames)

| # | Filename | Lines | Summary |
|---|---|---|---|
| 1 | `20260831004157_01_extensions_and_helpers.sql` | 20 | Enables `pgcrypto`; defines `set_updated_at()` trigger function. |
| 2 | `20260831004212_02_users_and_profiles.sql` | 53 | Creates `public.users`; `handle_new_user()` + trigger `on_auth_user_created` on `auth.users`; `trg_users_updated_at`. |
| 3 | `20260831004231_03_academic_hierarchy.sql` | 114 | Creates the nine academic-hierarchy/content tables (years → content). |
| 4 | `20260831004247_04_assignments_enrollments.sql` | 45 | Creates `student_assignments` and `teacher_assignments`. |
| 5 | `20260831004304_05_learning_content.sql` | 67 | Creates `formulas`, `questions`, `tests`, `results`. |
| 6 | `20260831004625_06_engagement_and_progress.sql` | 92 | Creates `announcements`, `reels` (+ bookmarks, watch history), `progress`, `achievements`, `student_achievements`. |
| 7 | `20260831004710_07_virtual_lab_schema.sql` | 131 | Creates the Virtual Lab / experiment tables (8 tables; unused by the UI). |
| 8 | `20260831004733_08_security_functions.sql` | 62 | Role and scope helpers: `current_role`, `is_admin`, `is_teacher_or_admin`, `teacher_has_subject`, `student_enrolled_in_subject`, `get_subject_id_for_topic`. |
| 9 | `20260831004755_09_protected_columns_triggers.sql` | 58 | Column-protection triggers: `protect_sensitive_user_columns`, `protect_attempt_scoring_columns`. |
| 10 | `20260831004829_10_rls_core.sql` | 172 | RLS policies: academic hierarchy, `users`, assignments. |
| 11 | `20260831004915_11_rls_learning_and_engagement.sql` | 251 | RLS policies: learning content and engagement tables. |
| 12 | `20260831004951_12_rls_virtual_lab.sql` | 174 | RLS policies: Virtual Lab tables. |
| 13 | `20260831005021_13_storage.sql` | 76 | Creates buckets `avatars` (public) and `content-files` (private) and their storage policies. |
| 14 | `20260831114824_14_fix_teacher_student_visibility.sql` | 42 | Policy fix for teacher/student visibility. |
| 15 | `20260901054641_15_secure_test_assessment_system.sql` | 238 | Secure assessment system: `get_test_questions`, `submit_test_attempt`, `validate_test_questions` trigger; redefines `protect_sensitive_user_columns`. |
| 16 | `20260901054708_15b_revoke_anon_execute_on_assessment_functions.sql` | 21 | Revokes anon EXECUTE on assessment functions. |
| 17 | `20260901154245_17_progress_streak_achievements.sql` | 349 | Creates `content_completions`; progress/XP/streak/achievement functions; redefines `submit_test_attempt` and `protect_sensitive_user_columns`. |
| 18 | `20260902004356_18_seed_achievement_catalog.sql` | 36 | Seeds the achievement catalog (data). |
| 19 | `20260908012153_19_first_super_admin_bootstrap.sql` | 130 | `bootstrap_first_super_admin(uuid)` (one-time first super_admin mechanism); extends `protect_sensitive_user_columns`. Execute revoked from public/anon/authenticated. |
| 20 | `20260909005357_phase14_1_content_files_scoped_read.sql` | 45 | `content_file_authorized()` and a scoped read policy for `content-files`. |
| 21 | `20260909005402_phase14_1_set_updated_at_search_path.sql` | 14 | Fixes `set_updated_at` search_path. |
| 22 | `20260909005459_phase14_1_content_file_authorized_admin_shortcircuit.sql` | 32 | Admin short-circuit in `content_file_authorized`. |
| 23 | `20260910154057_teacher_student_assignment.sql` | 134 | `assign_student_to_section`, `teacher_has_section`. |
| 24 | `20260911003322_teacher_assignable_students_search.sql` | 53 | `search_assignable_students` RPC. |
| 25 | `20260912064843_academic_operations_foundation.sql` | 766 | Creates attendance, class-teacher, CR, IA, lab-batch and timetable tables with validation triggers, RLS and assignment RPCs. |
| 26 | `20260912171054_single_current_academic_year.sql` | 37 | Trigger enforcing a single current academic year. |
| 27 | `20260913011853_teacher_assignment_hierarchy_check.sql` | 47 | Trigger validating teacher-assignment hierarchy. |
| 28 | `20260913061420_timetable_validation.sql` | 64 | Timetable entry validation. |
| 29 | `20260913130942_attendance_validation.sql` | 56 | Attendance record validation trigger. |
| 30 | `20260913182105_ia_max_marks_protection.sql` | 19 | Trigger protecting IA max marks. |
| 31 | `20260914070233_ia_marks_section_scope.sql` | 42 | IA marks policies scoped by section. |
| 32 | `20260914120157_ia_marks_class_teacher_fix.sql` | 19 | IA marks policy fix for class teachers. |
| 33 | `20260915011148_teacher_assignments_student_section_read.sql` | 19 | Policy: students read teacher assignments for their section. |
| 34 | `20260915074442_student_teacher_identity_read.sql` | 32 | `get_my_section_teachers` RPC. |
| 35 | `20260915080107_usn_field.sql` | 20 | Adds `users.usn` with format check and partial unique index. |
| 36 | `20260915080245_class_teacher_cr_write_scope_fix.sql` | 48 | `is_current_cr_of_section` and write-scope policy fixes. |
| 37 | `20260915080628_cr_designations_policy_correction.sql` | 49 | `end_cr_designation` RPC and policy correction. |
| 38 | `20260916014750_questions_remove_student_raw_select.sql` | 24 | Removes student row-level SELECT on `questions` (security fix). |
| 39 | `20260919153622_notes_module.sql` | 314 | Creates `notes`; `notes_*` helpers; `validate_note` trigger; notes storage policies. |
| 40 | `20260920073748_planner_events.sql` | 318 | Creates `planner_events`; `planner_*` helpers; validation trigger; policies. |
| 41 | `20260920092629_global_search.sql` | 153 | `global_search` RPC. |
| 42 | `20260920142303_academic_analytics.sql` | 431 | `analytics_*` functions (8). |
| 43 | `20260920142604_academic_analytics_fix_column_ambiguity.sql` | 110 | Fixes `analytics_pair_stats`, `analytics_roster`. |
| 44 | `20260920144332_study_mode.sql` | 95 | `study_outline`, `study_topic_context`. |
| 45 | `20260921083412_smart_study_overview.sql` | 385 | `smart_study_overview` RPC. |
| 46 | `20260924003912_fix_protect_sensitive_user_columns_null_bypass.sql` | 34 | Fixes a null-bypass in `protect_sensitive_user_columns`. |
| 47 | `20260925160114_admin_user_management_employee_id.sql` | 26 | Adds `users.employee_id` with format check and partial unique index. |
| 48 | `20260926100000_protect_user_email.sql` | 25 | Adds email protection to `protect_sensitive_user_columns`. |
| 49 | `20260926110000_timetable_conflict_detection.sql` | 105 | Extends `validate_timetable_entry` with conflict detection. |
| 50 | `20261006180000_note_chapters.sql` | 137 | Creates `note_chapters`; alters `notes`; chapter policies/trigger. |
| 51 | `20261006180100_notes_backfill_chapters.sql` | 49 | Backfills chapters for existing notes (data migration). |
| 52 | `20261006180200_notes_update_trigger.sql` | 113 | Redefines `validate_note`. |
| 53 | `20261006180300_global_search_note_chapters.sql` | 161 | Redefines `global_search` to include note chapters. |
| 54 | `20261006180400_smart_study_note_chapters.sql` | 367 | Redefines `smart_study_overview` for note chapters. |
| 55 | `20261009101000_fix_notes_trigger_display_name.sql` | 115 | Redefines `validate_note` (uploader display-name column fix). |
| 56 | `20261015214500_event_announcement_posters.sql` | 266 | Alters `announcements`/`planner_events` for poster paths; creates private `posters` bucket and policies; normalizes legacy poster URLs (data). |
| 57 | `20261021000000_assignment_system_reliability.sql` | 546 | Reassign/unassign RPCs, tightened teacher helpers, triggers `trg_student_assignment_section_change` and `trg_user_role_change_assignment_cleanup`. The Migration 21 header and reports call this "Migration 19" (see §3). |
| 58 | `20261101000000_20_bootstrap_first_super_admin_advisory_lock.sql` | 36 | Replaces `bootstrap_first_super_admin` to take a transaction-level advisory lock before checking for an existing super_admin. |
| 59 | `20261101010000_21_assignment_concurrency_hardening.sql` | 437 | Replaces four functions with ordered row locking and drops one RLS policy (see §5). |

Descriptions are derived from the SQL objects each file defines and are intentionally literal. They are not a substitute for reading the migration.

## 3. Migration numbering conflicts (documented, not resolved)

Filenames are unambiguous. The numbers in **headers** and in **reports** are not, so use the full filename or the 14-digit version when it matters.

| Term | Where it appears | What it refers to |
|---|---|---|
| "Migration 19" | file `20260908012153_19_first_super_admin_bootstrap.sql` (its own header: "Migration 19: First super_admin bootstrap mechanism") | first super_admin bootstrap |
| "Migration 19" | header of `20261101010000_21_assignment_concurrency_hardening.sql` ("follow-up to Migration 19 (assignment_system_reliability)") and the Migration 21 reports | `20261021000000_assignment_system_reliability.sql`, which carries no number label in its filename |
| "Migration 20" | filename label of `20261101000000_20_bootstrap_first_super_admin_advisory_lock.sql` | amends the function created in label `19` (bootstrap) |
| "Migration 20" | **header** of `20260910154057_teacher_student_assignment.sql` ("Migration 20: Teacher-scoped student assignment") | a different, earlier file |
| "Migration 20b" | header of `20260911003322_teacher_assignable_students_search.sql` | no filename label |
| "Migration 21" | filename label of `20261101010000_21_assignment_concurrency_hardening.sql` (the migration the owner and the recent reports mean) | amends functions defined in `20261021000000_assignment_system_reliability.sql` and `20260912064843_academic_operations_foundation.sql` |
| "Migration 21" | **header** of `20260912064843_academic_operations_foundation.sql` ("Migration 21: Phase 16A Academic Operations DB Foundation") | a different, earlier file |
| "Migration 22", "23", "24", "25" | headers of `20260912171054_single_current_academic_year.sql`, `20260913011853_teacher_assignment_hierarchy_check.sql`, `20260913061420_timetable_validation.sql`, `20260913130942_attendance_validation.sql` | no filename labels |
| "Migration 16" | header of `20260901054708_15b_revoke_anon_execute_on_assessment_functions.sql` (filename label `15b`) | there is no file labelled `16` |

**Convention used in these documents [A]:** "Migration 20" and "Migration 21" mean the two files whose filenames carry the labels `20` and `21` (versions `20261101000000` and `20261101010000`), as in the owner's and the recent reports' usage. Header-only numbers are not used.

**Recommendation for the owner (not applied):** refer to migrations by full filename or 14-digit version when ambiguity matters.

## 4. Schema organization — 44 public tables **[V]**

Row Level Security is enabled on **all 44 public application tables**: an `ALTER TABLE … ENABLE ROW LEVEL SECURITY` statement appears in the migration source for each of them. **[V static]** This statement is about those 44 tables only; it is not a claim about other schemas. Separately, 16 policies are defined on `storage.objects`. The live database was not queried. **[U]**

| Group | Tables |
|---|---|
| Identity | `users` |
| Academic hierarchy | `academic_years`, `regulations`, `programs`, `semesters`, `sections`, `subjects`, `units`, `topics` |
| Assignments | `student_assignments`, `teacher_assignments`, `class_teacher_assignments`, `cr_designations`, `lab_batches`, `student_lab_batch_assignments` |
| Learning content | `content`, `formulas`, `notes`, `note_chapters`, `questions`, `tests`, `results` |
| Progress and engagement | `progress`, `content_completions`, `achievements`, `student_achievements`, `announcements`, `planner_events` |
| Academic operations | `timetable_entries`, `attendance_records`, `attendance_audit_log`, `ia_assessments`, `ia_marks` |
| Legacy / unused by UI | `reels`, `reel_bookmarks`, `reel_watch_history`, `experiments`, `experiment_attempts`, `experiment_questions`, `experiment_required_components`, `lab_components`, `lab_component_properties`, `lab_component_terminals`, `student_circuits` |

### 4.1 `public.users` **[V]**

Columns: `id` (PK, FK → `auth.users` ON DELETE CASCADE), `email` (unique, not null), `full_name`, `phone`, `role` (check: `student|teacher|super_admin`, default `student`), `xp`, `streak`, `avatar_url`, `last_active_at`, `created_at`, `updated_at`; later `usn` (format `^[A-Z0-9]{6,15}$`, partial unique) and `employee_id` (format `^[A-Z0-9]{4,20}$`, partial unique).

A new Auth user automatically gets a `users` row with role `student` via `handle_new_user()`.

### 4.2 Table → creating migration

| Table | Created in |
|---|---|
| `users` | `20260831004212_02_users_and_profiles.sql` |
| `academic_years` | `20260831004231_03_academic_hierarchy.sql` |
| `regulations` | `20260831004231_03_academic_hierarchy.sql` |
| `programs` | `20260831004231_03_academic_hierarchy.sql` |
| `semesters` | `20260831004231_03_academic_hierarchy.sql` |
| `sections` | `20260831004231_03_academic_hierarchy.sql` |
| `subjects` | `20260831004231_03_academic_hierarchy.sql` |
| `units` | `20260831004231_03_academic_hierarchy.sql` |
| `topics` | `20260831004231_03_academic_hierarchy.sql` |
| `content` | `20260831004231_03_academic_hierarchy.sql` |
| `student_assignments` | `20260831004247_04_assignments_enrollments.sql` |
| `teacher_assignments` | `20260831004247_04_assignments_enrollments.sql` |
| `formulas` | `20260831004304_05_learning_content.sql` |
| `questions` | `20260831004304_05_learning_content.sql` |
| `tests` | `20260831004304_05_learning_content.sql` |
| `results` | `20260831004304_05_learning_content.sql` |
| `announcements` | `20260831004625_06_engagement_and_progress.sql` |
| `reels` | `20260831004625_06_engagement_and_progress.sql` |
| `reel_bookmarks` | `20260831004625_06_engagement_and_progress.sql` |
| `reel_watch_history` | `20260831004625_06_engagement_and_progress.sql` |
| `progress` | `20260831004625_06_engagement_and_progress.sql` |
| `achievements` | `20260831004625_06_engagement_and_progress.sql` |
| `student_achievements` | `20260831004625_06_engagement_and_progress.sql` |
| `lab_components` | `20260831004710_07_virtual_lab_schema.sql` |
| `lab_component_terminals` | `20260831004710_07_virtual_lab_schema.sql` |
| `lab_component_properties` | `20260831004710_07_virtual_lab_schema.sql` |
| `experiments` | `20260831004710_07_virtual_lab_schema.sql` |
| `experiment_required_components` | `20260831004710_07_virtual_lab_schema.sql` |
| `experiment_questions` | `20260831004710_07_virtual_lab_schema.sql` |
| `student_circuits` | `20260831004710_07_virtual_lab_schema.sql` |
| `experiment_attempts` | `20260831004710_07_virtual_lab_schema.sql` |
| `content_completions` | `20260901154245_17_progress_streak_achievements.sql` |
| `class_teacher_assignments` | `20260912064843_academic_operations_foundation.sql` |
| `cr_designations` | `20260912064843_academic_operations_foundation.sql` |
| `lab_batches` | `20260912064843_academic_operations_foundation.sql` |
| `student_lab_batch_assignments` | `20260912064843_academic_operations_foundation.sql` |
| `timetable_entries` | `20260912064843_academic_operations_foundation.sql` |
| `attendance_records` | `20260912064843_academic_operations_foundation.sql` |
| `attendance_audit_log` | `20260912064843_academic_operations_foundation.sql` |
| `ia_assessments` | `20260912064843_academic_operations_foundation.sql` |
| `ia_marks` | `20260912064843_academic_operations_foundation.sql` |
| `notes` | `20260919153622_notes_module.sql` |
| `planner_events` | `20260920073748_planner_events.sql` |
| `note_chapters` | `20261006180000_note_chapters.sql` |

## 5. Migrations 20 and 21 (verified facts)

### 5.1 Migration 20 — `20261101000000_20_bootstrap_first_super_admin_advisory_lock.sql` **[V]**
One statement: `CREATE OR REPLACE FUNCTION public.bootstrap_first_super_admin(p_user_id uuid)`; `SECURITY DEFINER`, `search_path = 'public'`. It takes `pg_advisory_xact_lock(hashtext('public.bootstrap_first_super_admin')::bigint)` first, refuses if any `super_admin` already exists, refuses if the target `users` row does not exist, sets the transaction-local flag `app.first_admin_bootstrap`, then updates the role. Last commit: `5b24d09` (2026-11-01).

### 5.2 Migration 21 — `20261101010000_21_assignment_concurrency_hardening.sql` **[V]**
437 lines; last commit `6d55753` (2026-11-14). Per its own header it adds no tables, columns, indexes or policies, and contains five top-level statements:

| Part | Change |
|---|---|
| A | `CREATE OR REPLACE FUNCTION public.assign_student_to_section` — locks the student's `users` row (`FOR UPDATE`) before validation |
| B | `… assign_class_teacher` — locks the teacher's `users` row, then the destination `sections` row |
| C | `… end_class_teacher` — locks the `sections` row before ending the current assignment |
| D | `… trg_handle_user_role_change` — on demotion, locks affected `sections` rows in `id ASC` order |
| E | `DROP POLICY IF EXISTS class_teacher_assignments_write_admin_only ON public.class_teacher_assignments` — leaves only `class_teacher_assignments_select`, so direct client writes are no longer permitted and writes go through the two RPCs |

Documented lock order: `users` row → `sections` row(s) in id order → assignment rows. The header explicitly limits this guarantee to the student-assignment, class-teacher and role-change paths and states that other write paths were not audited. **[V]**
Permissions: the file contains no GRANT/REVOKE; it relies on `CREATE OR REPLACE` preserving existing ACLs. **[V]**

### 5.3 Rollback status — **Migration 21 has no rollback migration or script in the repository** **[V]**
- The only file in `supabase/rollback/` is `20261021000000_assignment_system_reliability.rollback.sql` (for a different migration).
- That script predates Migration 21 (its last commit precedes it). Whether it is safe to run on a database where Migration 21 is applied is **[U]** and should not be assumed.
- Existing reports recommend writing a rollback script; none exists in the tracked tree. **[R]**
- For orientation only: the pre-Migration-21 definitions of the four functions are in `20261021000000_assignment_system_reliability.sql` (`assign_student_to_section`, `end_class_teacher`, `trg_handle_user_role_change`) and `20260912064843_academic_operations_foundation.sql` (`assign_class_teacher`, and the dropped policy). This is a pointer, not a rollback plan.

### 5.4 Tests **[V]**
`supabase/tests/assignment_concurrency_test.sql` (1,567 lines): an executable single-transaction regression section (9 test groups, ends in `ROLLBACK`) plus commented manual procedures for five two-session concurrency scenarios and a scoped teardown. Two other test scripts cover the earlier reliability migration.

### 5.5 Statement-count note **[U]**
A report quotes `num_statements: 6` for Migration 21 in `supabase_migrations.schema_migrations`. A scan of the source finds 5 top-level statements (A–E). How the CLI counts statements was not investigated. This does not affect the verified match of function bodies reported in the production catalog report. **[R]**

## 6. Functions **[V static]**

About 70 distinct functions are defined across the migrations: **54 SECURITY DEFINER** and **16 SECURITY INVOKER**; every one declares a `search_path` in its definition text.

SECURITY INVOKER (RLS applies to the caller): `analytics_admin_overview`, `analytics_pair_stats`, `analytics_roster`, `analytics_scope_pairs`, `analytics_student_rows`, `analytics_student_subjects`, `analytics_student_summary`, `analytics_student_tests`, `content_file_authorized`, `global_search`, `notes_object_manageable`, `notes_object_viewable`, `set_updated_at`, `smart_study_overview`, `study_outline`, `study_topic_context`.

| Category | Functions (latest defining migration in parentheses where useful) |
|---|---|
| Role/identity helpers | `current_role`, `is_admin`, `is_teacher_or_admin` |
| Scope helpers | `teacher_has_subject`, `teacher_has_section`, `teacher_has_subject_in_section`, `teacher_manages_subject`, `student_enrolled_in_subject`, `student_currently_in_section`, `student_currently_in_subject`, `is_class_teacher_of_section`, `is_current_cr_of_section`, `get_subject_id_for_topic`, `content_file_authorized`, `notes_manager`, `notes_viewer`, `notes_object_manageable`, `notes_object_viewable`, `planner_can_manage`, `planner_student_can_see`, `planner_teacher_can_see` |
| Assignment RPCs | `assign_student_to_section`, `reassign_student_to_section`, `assign_class_teacher`, `end_class_teacher`, `assign_cr_designation`, `end_cr_designation`, `assign_lab_batch`, `unassign_lab_batch`, `search_assignable_students`, `get_my_section_teachers` |
| Assessment/progress | `get_test_questions`, `submit_test_attempt`, `mark_content_complete`, `record_daily_activity`, `recalc_topic_progress`, `award_achievement_if_earned` |
| Study/search/analytics | `study_outline`, `study_topic_context`, `smart_study_overview`, `global_search`, `analytics_*` (8) |
| Bootstrap | `bootstrap_first_super_admin` |
| Trigger functions | `set_updated_at`, `handle_new_user`, `protect_sensitive_user_columns`, `protect_attempt_scoring_columns`, `enforce_single_current_academic_year`, `stamp_attendance_record`, `stamp_and_validate_ia_marks`, `trg_handle_student_assignment_change`, `trg_handle_user_role_change`, and the `validate_*` functions (attendance record, class teacher assignment, CR designation, IA max marks, note, note chapter, planner event, lab batch assignment, teacher assignment hierarchy, test questions, timetable entry) |

Client RPC usage (literal `.rpc("…")` calls in `src/`): `analytics_admin_overview`, `assign_class_teacher`, `assign_cr_designation`, `assign_lab_batch`, `assign_student_to_section`, `end_class_teacher`, `end_cr_designation`, `get_my_section_teachers`, `get_test_questions`, `global_search`, `mark_content_complete`, `reassign_student_to_section`, `search_assignable_students`, `smart_study_overview`, `study_outline`, `study_topic_context`, `submit_test_attempt`, `unassign_lab_batch`. The student/teacher analytics RPCs are called through a shared helper in `lib/analytics.ts` (`supabase.rpc(fn, args)`). **[V]**

## 7. Triggers (static replay) **[V]**

| Trigger | Timing / event | Table | Defined in |
|---|---|---|---|
| `academic_years_single_current` | BEFORE insert or update of is_current | `academic_years` | `20260912171054_single_current_academic_year.sql` |
| `attendance_records_stamp` | BEFORE insert or update | `attendance_records` | `20260912064843_academic_operations_foundation.sql` |
| `attendance_records_validate` | BEFORE insert or update | `attendance_records` | `20260913130942_attendance_validation.sql` |
| `class_teacher_assignments_validate` | BEFORE insert or update | `class_teacher_assignments` | `20260912064843_academic_operations_foundation.sql` |
| `cr_designations_validate` | BEFORE insert or update | `cr_designations` | `20260912064843_academic_operations_foundation.sql` |
| `ia_assessments_validate_max_marks` | BEFORE update | `ia_assessments` | `20260913182105_ia_max_marks_protection.sql` |
| `ia_marks_stamp_and_validate` | BEFORE insert or update | `ia_marks` | `20260912064843_academic_operations_foundation.sql` |
| `note_chapters_validate` | BEFORE insert or update | `note_chapters` | `20261006180000_note_chapters.sql` |
| `notes_validate` | BEFORE insert or update | `notes` | `20260919153622_notes_module.sql` |
| `on_auth_user_created` | AFTER insert | `auth.users` | `20260831004212_02_users_and_profiles.sql` |
| `planner_events_validate` | BEFORE insert or update | `planner_events` | `20260920073748_planner_events.sql` |
| `student_lab_batch_assignments_validate` | BEFORE insert or update | `student_lab_batch_assignments` | `20260912064843_academic_operations_foundation.sql` |
| `teacher_assignments_validate_hierarchy` | BEFORE insert or update | `teacher_assignments` | `20260913011853_teacher_assignment_hierarchy_check.sql` |
| `timetable_entries_validate` | BEFORE insert or update | `timetable_entries` | `20260912064843_academic_operations_foundation.sql` |
| `trg_experiments_updated_at` | BEFORE update | `experiments` | `20260831004710_07_virtual_lab_schema.sql` |
| `trg_protect_attempt_scoring_columns` | BEFORE update | `experiment_attempts` | `20260831004755_09_protected_columns_triggers.sql` |
| `trg_protect_sensitive_user_columns` | BEFORE update | `users` | `20260831004755_09_protected_columns_triggers.sql` |
| `trg_student_assignment_section_change` | AFTER update of is_current, section_id or delete | `student_assignments` | `20261021000000_assignment_system_reliability.sql` |
| `trg_student_circuits_updated_at` | BEFORE update | `student_circuits` | `20260831004710_07_virtual_lab_schema.sql` |
| `trg_user_role_change_assignment_cleanup` | AFTER update of role | `users` | `20261021000000_assignment_system_reliability.sql` |
| `trg_users_updated_at` | BEFORE update | `users` | `20260831004212_02_users_and_profiles.sql` |
| `trg_validate_test_questions` | BEFORE insert or update of question_ids, subject_id, topic_id | `tests` | `20260901054641_15_secure_test_assessment_system.sql` |

Notes: `trg_user_role_change_assignment_cleanup` (not `trg_user_role_change`, which one report uses) is the trigger bound to `trg_handle_user_role_change()`. `protect_sensitive_user_columns` was redefined in migrations 15, 17, 19, `20260924003912…`, and `20260926100000_protect_user_email.sql` (latest). **[V]**

## 8. RLS policies (static replay) **[V]**

Static replay yields **109 policies on the 44 public tables** and **16 on `storage.objects`**. The older handoff document's "~106 policies" predates later migrations. Live policy counts were not queried here. **[U]**

Policy names follow `<table>_<action>[_<qualifier>]`. Notable shapes: most hierarchy tables have `*_select_authenticated` + `*_write_admin_only`; write-restricted assignment tables allow writes only through admin or RPCs; `class_teacher_assignments` has **SELECT only** after Migration 21.

| Table | Policies (command) |
|---|---|
| `academic_years` | `academic_years_select_authenticated` (SELECT); `academic_years_write_admin_only` (ALL) |
| `achievements` | `achievements_select_authenticated` (SELECT); `achievements_write_admin_only` (ALL) |
| `announcements` | `announcements_select` (SELECT); `announcements_delete_admin_only` (DELETE); `announcements_insert` (INSERT); `announcements_delete_cr_own` (DELETE) |
| `attendance_audit_log` | `attendance_audit_log_select` (SELECT) |
| `attendance_records` | `attendance_records_select` (SELECT); `attendance_records_insert` (INSERT); `attendance_records_update` (UPDATE) |
| `class_teacher_assignments` | `class_teacher_assignments_select` (SELECT) |
| `content` | `content_select` (SELECT); `content_insert` (INSERT); `content_update` (UPDATE); `content_delete_admin_only` (DELETE) |
| `content_completions` | `content_completions_select` (SELECT); `content_completions_admin_only_write` (ALL) |
| `cr_designations` | `cr_designations_select` (SELECT); `cr_designations_write_admin_only` (ALL) |
| `experiment_attempts` | `experiment_attempts_select` (SELECT); `experiment_attempts_insert_own` (INSERT); `experiment_attempts_update_own_or_trusted` (UPDATE); `experiment_attempts_delete_admin_only` (DELETE) |
| `experiment_questions` | `experiment_questions_select` (SELECT); `experiment_questions_write` (ALL) |
| `experiment_required_components` | `experiment_required_components_select` (SELECT); `experiment_required_components_write` (ALL) |
| `experiments` | `experiments_select` (SELECT); `experiments_insert` (INSERT); `experiments_update` (UPDATE); `experiments_delete_admin_only` (DELETE) |
| `formulas` | `formulas_select` (SELECT); `formulas_insert` (INSERT); `formulas_update` (UPDATE); `formulas_delete_admin_only` (DELETE) |
| `ia_assessments` | `ia_assessments_select` (SELECT); `ia_assessments_write_admin_only` (ALL) |
| `ia_marks` | `ia_marks_write` (ALL); `ia_marks_select` (SELECT) |
| `lab_batches` | `lab_batches_select` (SELECT); `lab_batches_write_admin_only` (ALL) |
| `lab_component_properties` | `lab_component_properties_select_authenticated` (SELECT); `lab_component_properties_write_admin_only` (ALL) |
| `lab_component_terminals` | `lab_component_terminals_select_authenticated` (SELECT); `lab_component_terminals_write_admin_only` (ALL) |
| `lab_components` | `lab_components_select_authenticated` (SELECT); `lab_components_write_admin_only` (ALL) |
| `note_chapters` | `note_chapters_select` (SELECT); `note_chapters_insert` (INSERT); `note_chapters_update` (UPDATE); `note_chapters_delete` (DELETE) |
| `notes` | `notes_select` (SELECT); `notes_insert` (INSERT); `notes_update` (UPDATE); `notes_delete` (DELETE) |
| `planner_events` | `planner_events_select` (SELECT); `planner_events_insert` (INSERT); `planner_events_update` (UPDATE); `planner_events_delete` (DELETE) |
| `programs` | `programs_select_authenticated` (SELECT); `programs_write_admin_only` (ALL) |
| `progress` | `progress_select` (SELECT); `progress_write_admin_only` (ALL) |
| `questions` | `questions_insert` (INSERT); `questions_update` (UPDATE); `questions_delete_admin_only` (DELETE); `questions_select` (SELECT) |
| `reel_bookmarks` | `reel_bookmarks_own` (ALL) |
| `reel_watch_history` | `reel_watch_history_own` (ALL) |
| `reels` | `reels_select` (SELECT); `reels_insert_teacher_or_admin` (INSERT); `reels_update_teacher_or_admin` (UPDATE); `reels_delete_admin_only` (DELETE) |
| `regulations` | `regulations_select_authenticated` (SELECT); `regulations_write_admin_only` (ALL) |
| `results` | `results_select` (SELECT); `results_update_admin_only` (UPDATE); `results_delete_admin_only` (DELETE); `results_insert_admin_only` (INSERT) |
| `sections` | `sections_select_authenticated` (SELECT); `sections_write_admin_only` (ALL) |
| `semesters` | `semesters_select_authenticated` (SELECT); `semesters_write_admin_only` (ALL) |
| `storage.objects` | `avatars_public_read` (SELECT); `avatars_own_folder_write` (INSERT); `avatars_own_folder_update` (UPDATE); `avatars_own_folder_delete` (DELETE); `content_files_scoped_read` (SELECT); `content_files_staff_write` (INSERT); `content_files_staff_update` (UPDATE); `content_files_admin_delete` (DELETE); `notes_files_scoped_read` (SELECT); `notes_files_scoped_write` (INSERT); `notes_files_scoped_update` (UPDATE); `notes_files_scoped_delete` (DELETE); `posters_authorized_read` (SELECT); `posters_authorized_insert` (INSERT); `posters_authorized_update` (UPDATE); `posters_authorized_delete` (DELETE) |
| `student_achievements` | `student_achievements_select` (SELECT); `student_achievements_write_trusted_only` (INSERT) |
| `student_assignments` | `student_assignments_select` (SELECT); `student_assignments_write_admin_only` (ALL) |
| `student_circuits` | `student_circuits_own` (ALL) |
| `student_lab_batch_assignments` | `student_lab_batch_assignments_select` (SELECT); `student_lab_batch_assignments_write_admin_only` (ALL) |
| `subjects` | `subjects_select_authenticated` (SELECT); `subjects_write_admin_only` (ALL) |
| `teacher_assignments` | `teacher_assignments_write_admin_only` (ALL); `teacher_assignments_select` (SELECT) |
| `tests` | `tests_select` (SELECT); `tests_insert` (INSERT); `tests_update` (UPDATE); `tests_delete_admin_only` (DELETE) |
| `timetable_entries` | `timetable_entries_select` (SELECT); `timetable_entries_write_admin_only` (ALL) |
| `topics` | `topics_select_authenticated` (SELECT); `topics_write_admin_only` (ALL) |
| `units` | `units_select_authenticated` (SELECT); `units_write_admin_only` (ALL) |
| `users` | `users_update_own_or_admin` (UPDATE); `users_delete_admin_only` (DELETE); `users_select_own_or_admin_or_teacher` (SELECT) |

## 9. Storage **[V]**

| Bucket | Public | Size limit | Allowed MIME types | Defined in |
|---|---|---|---|---|
| `avatars` | yes (intentional) | 5 MiB | png, jpeg, webp | `20260831005021_13_storage.sql` |
| `content-files` | no | 50 MiB | pdf, png, jpeg | `20260831005021_13_storage.sql` |
| `posters` | no | 5 MiB | png, jpeg, webp | `20261015214500_event_announcement_posters.sql` |

`storage.objects` policies: `avatars_*` (public read; own-folder write/update/delete), `content_files_scoped_read` / `content_files_staff_write` / `content_files_staff_update` / `content_files_admin_delete`, `notes_files_scoped_*` (read/write/update/delete), `posters_authorized_*` (read/insert/update/delete). Private files are served through signed URLs (README: 1 hour). The README lists only two buckets; the `posters` bucket is a documentation gap (`05-PROJECT-STATUS-AND-KNOWN-ISSUES.md`).

## 10. Migration 21 and the state of production: keep these four things separate

| # | Statement | Evidence class | Notes |
|---|---|---|---|
| 1 | Migrations 20 and 21 are committed and pushed to `main` (`5b24d09`, `6d55753`) | **[V]** git history | Says nothing about any database |
| 2 | Migration 21 passed isolated-environment tests (9 regression groups, 5 two-session concurrency scenarios) and the security audit status is "READY FOR PRODUCTION REVIEW" (explicitly not "production-approved") | **[R]** `MIGRATION_21_ISOLATED_TEST_REPORT.md`, `MIGRATION_21_FINAL_SECURITY_AUDIT.md` | Evidence from a disposable local database, not production |
| 3 | A **historical, read-only production catalog verification dated 2026-11-14** reported that the live definitions of the four functions match the committed SQL, that `class_teacher_assignments` has only the SELECT policy, that trigger `trg_user_role_change_assignment_cleanup` is enabled, and that migration history contains versions `20261101000000` and `20261101010000` | **[R]** `MIGRATION_21_PRODUCTION_CATALOG_VERIFICATION.md` | A point-in-time observation |
| 4 | **Current live production state** | **[U]** | **Not rechecked** for this documentation. The owner has stated that Migration 21 is verified in production **[O]**; no check after 2026-11-14 is recorded in these documents |

Also open:
- **[U]** No document records when or by whom Migration 21 was applied. The "2026-11-01 01:00:00 UTC" shown in one report is the migration's *version number*, not an apply time, and is not to be cited as one.
- **[U]** The older handoff document refers to a live migration version `20260925160127_admin_user_management_employee_id`, while the repository file is `20260925160114_admin_user_management_employee_id.sql`. Whether production's recorded version differs from the filename is unverified.
