# ECE Hub Buddy — Security and Access-Control Reference

> **Source baseline:** GitHub `main` @ `a5c8b3e97c72066119eb6a76db4387c6e3d00566` (verified 2026-11-27). Everything database-related here was derived at `6d55753` and re-checked on 2026-11-27: no file under `supabase/` differs between `6d55753` and `a5c8b3e`.
> **Tags:** **[V]** verified in tracked source · **[O]** owner-stated · **[R]** reported by an existing untracked report, not re-verified · **[H]** historical statement in an existing document · **[A]** assumption · **[U]** unresolved / unverified.
>
> This document describes what the *source* defines. It makes **no claim about live production configuration** unless tagged **[R]**. No secrets, keys or credentials appear here, and none were requested or accessed.

## 1. Security model in one page

1. **Authorization is enforced in Postgres.** There is no custom application server. All 44 public application tables have RLS enabled in the migration source; sensitive operations go through RPCs. **[V static]** (Policies on `storage.objects` are covered separately in §8; no claim is made about other schemas.)
2. **Frontend guards are UX only.** `ProtectedRoute`, `ClassTeacherRoute` (which additionally gates `/teacher/cr` and `/teacher/lab-batches` on a current Class Teacher assignment) and per-role login pages decide what is displayed; they do not grant or deny data access. The source comment says so explicitly. **[V]**
3. **Identity comes from the JWT.** RPCs and policies use `auth.uid()`; the role is read from `public.users`, never from client-supplied data. **[V]**
4. **Privileged columns are trigger-protected.** Non-admins cannot change `role`, `email`, `xp` or `streak` directly. **[V]**
5. **The service-role key exists in one place:** the `admin-create-user` Edge Function (as a platform-provided environment variable). The browser only ever has the public (anon/publishable) key. **[V]**

## 2. Authentication

| Topic | Source facts |
|---|---|
| Method | Supabase Auth, email + password. A `/reset-password` recovery flow and a self-service password change exist. **[V]** |
| Sign-in UX | Three portals (`/student/login`, `/teacher/login`, `/admin/login`). A signed-in account whose database role differs from the portal is signed out with a message. **[V]** |
| Account creation | Admin-only through `/admin/user-management` → Edge Function `admin-create-user`; or manually in Supabase. No sign-up page exists in the route table. **[V]** |
| Profile row | `handle_new_user()` (trigger on `auth.users`, SECURITY DEFINER) inserts a `public.users` row with role `student`. **[V]** |
| Passwords | Never stored or compared by app code; no password touches `public.users`. **[V]** (`lib/passwordChange.ts` header) |
| Local config | `supabase/config.toml` has `enable_signup = true`, `minimum_password_length = 6`, `jwt_expiry = 3600`, refresh-token rotation on, anonymous sign-ins off, MFA off. This file configures the **local** CLI stack only. **[V]** |
| Production Auth settings | Whether public sign-up is enabled in production, Site URL/redirect URLs, password policy and leaked-password protection are **[U]**. The older handoff text says leaked-password protection is off. **[H]** |

**Review item [U]:** the README says there is no self-signup, but sign-up is a *platform* setting, not a UI route. If the production project allows sign-up, an arbitrary visitor could create an Auth user, which `handle_new_user()` would turn into a `student` row with no assignment. The effect depends on RLS for assignment-less students and is not assessed here.

### 2.1 Leaked-password protection: review notes (2026-11-27)
- **The setting (vendor documentation) [A].** Supabase's "Password security" page (https://supabase.com/docs/guides/auth/password-security, read 2026-11-27) lists "Prevent the use of leaked passwords": Supabase Auth uses the HaveIBeenPwned.org Pwned Passwords API to reject passwords known to have leaked, and the feature is available on the **Pro plan and above**. The page says the strengthened requirements apply to new users and to existing users who change their password, and that existing users can still sign in with their current password but will "encounter a `WeakPasswordError` during the `signInWithPassword` process" explaining why it is weak. It does **not** say how admin-created accounts or password resets are treated, or what data is sent to the external service; those points are not established here **[U]**. `[A]` means taken from the vendor's documentation, not observed on this project.
- **Current state here.** Unknown for production **[U]**; the older handoff says it is off **[H]**. `supabase/config.toml` (local stack only) sets `minimum_password_length = 6` and an empty `password_requirements`. **[V]**
- **What the application does today [V].** The client enforces at least 8 characters with a letter and a number (`lib/passwordChange.ts`) and maps Auth's `weak_password` error to "That password is too weak. Try a longer one with letters and numbers." on password change and recovery. `admin-create-user` returns the Auth error message when `auth.admin.createUser` fails, so a rejected temporary password would be shown to the admin. At sign-in, `AuthContext.signIn` (`contexts/AuthContext.tsx:121`) and `changeOwnPassword` (`lib/passwordChange.ts:129`) read only the `error` field. The installed `@supabase/auth-js` 2.112.4 (`dist/main/GoTrueClient.js`, `signInWithPassword`) returns the weak-password notice for an existing user as `data.weakPassword` alongside a valid session, not as an error. So if the setting were enabled, an existing user with a weak or leaked password would most likely still sign in and would see no prompt to change it. The code paths are verified; how the hosted service behaves for this project is **[U]**. The generic "too weak" message also would not say that a password was found in a breach. Improving either behaviour would be a separate, optional change (not made).
- **Operational considerations.** The feature requires a paid plan **[A]**. Before enabling it, test on a non-production project with a known-breached password for: password change, password reset (recovery), admin-created accounts (`admin-create-user`) and sign-in of an existing weak-password user, because the vendor page does not describe all of these **[U]**. By the documented behaviour, existing users are not forced to change their password. Any script or process that creates users with common passwords may start failing.
- **Decision.** Whether and when to enable it is an owner decision (`05-PROJECT-STATUS-AND-KNOWN-ISSUES.md` §7, item 5).

## 3. Roles and the privileged-column guard

Roles (CHECK constraint on `users.role`): `student`, `teacher`, `super_admin`. **[V]**

`protect_sensitive_user_columns()` (BEFORE UPDATE trigger on `users`; latest definition `20260926100000_protect_user_email.sql`) **[V]**:
- If the caller is not `is_admin()`: changing `role` raises an exception, except for the one-time first-super_admin bootstrap path described below; changing `email` raises; changing `xp` or `streak` raises unless the transaction-local setting `app.trusted_engagement_update = 'true'` (set only inside trusted SECURITY DEFINER functions).
- Admins are not blocked by this trigger.

**First super_admin bootstrap [V]:** `bootstrap_first_super_admin(uuid)` is the only way a first `super_admin` can be created from inside the database. Execute is revoked from `PUBLIC`, `anon` and `authenticated` (Migration `…19`). Migration 20 adds a transaction-level advisory lock so two concurrent calls cannot both succeed; the function refuses once any `super_admin` exists. It is intended to be run only as an explicit, human-approved SQL action. No migration assigns anyone.

## 4. Helper functions that policies depend on **[V]**

`current_role()`, `is_admin()`, `is_teacher_or_admin()`, `teacher_has_subject()`, `teacher_has_section()`, `teacher_has_subject_in_section()`, `teacher_manages_subject()`, `student_enrolled_in_subject()`, `student_currently_in_section()`, `student_currently_in_subject()`, `is_class_teacher_of_section()`, `is_current_cr_of_section()`, `get_subject_id_for_topic()`, `content_file_authorized()`, `notes_manager()`, `notes_viewer()`, `notes_object_manageable()`, `notes_object_viewable()`, `planner_can_manage()`, `planner_student_can_see()`, `planner_teacher_can_see()`.

Most are SECURITY DEFINER with `search_path = public` so they can read `users`/assignment tables without exposing those tables to the caller. Two (`content_file_authorized`, `notes_object_*`) are SECURITY INVOKER.

## 5. RLS overview **[V static]**

All 44 public application tables have RLS enabled (migration source); static replay of the migrations yields 109 policies on public tables and 16 on `storage.objects` (full list in `02-DATABASE-AND-MIGRATIONS.md` §8). Patterns:

| Area | Pattern (from policy names/commands; read the migration for exact predicates) |
|---|---|
| Hierarchy tables | SELECT for any authenticated user; writes `*_write_admin_only` |
| `users` | SELECT own/admin/teacher; UPDATE own or admin (guarded by the trigger above); DELETE admin only |
| Assignments | `student_assignments` and `teacher_assignments`: SELECT scoped; writes admin-only (plus RPCs) |
| `class_teacher_assignments` | **SELECT only** since Migration 21; changes go through `assign_class_teacher` / `end_class_teacher` |
| `questions` | SELECT only for admin and the subject's teacher; **students have no row-level SELECT** (`20260916014750…`, fixes a leak of `correct_answer`); students use `get_test_questions()` |
| `results`, `progress`, `content_completions`, `achievements` | Students cannot insert/update directly: `results_insert_admin_only`, `progress_write_admin_only`, `content_completions_admin_only_write`, `student_achievements_write_trusted_only`; data is written by SECURITY DEFINER RPCs |
| `tests`, `content`, `formulas`, `experiments`… | insert/update for teacher or admin scopes; delete admin-only |
| `notes`, `note_chapters`, `planner_events` | Four policies each (select/insert/update/delete) driven by the helper functions in §4 |
| `announcements` | `announcements_select`, `announcements_insert`, `announcements_delete_admin_only`, `announcements_delete_cr_own` |
| Timetable, attendance, IA | admin writes plus scoped teacher/CR/class-teacher policies; `attendance_audit_log` SELECT only |

## 6. Function security: three separate layers

These are three different questions. A statement about one layer says nothing about the others.

### 6.1 Classification: SECURITY DEFINER versus SECURITY INVOKER **[V static]**
Read from each function's definition text in the migrations.

- About 70 distinct functions: **54 SECURITY DEFINER** (run with the function owner's privileges) and **16 SECURITY INVOKER** (run with the caller's privileges, so RLS applies to what they read).
- Every function definition text declares a `search_path`.
- **SECURITY INVOKER (16):** `analytics_admin_overview`, `analytics_pair_stats`, `analytics_roster`, `analytics_scope_pairs`, `analytics_student_rows`, `analytics_student_subjects`, `analytics_student_summary`, `analytics_student_tests`, `content_file_authorized`, `global_search`, `notes_object_manageable`, `notes_object_viewable`, `set_updated_at`, `smart_study_overview`, `study_outline`, `study_topic_context`.
- Everything else is SECURITY DEFINER, including the role helpers, assignment RPCs, assessment and progress functions, and the trigger functions.

### 6.2 GRANT / REVOKE statements found in migration source **[V static]**
This layer records **what the SQL text says**, not what is effective in any database. A function with no statement here is governed by whatever default privileges the platform applies at creation (unknown from the source).

| What the migration source says | Functions |
|---|---|
| `REVOKE … FROM public` and `FROM anon`, then `GRANT … TO authenticated` | `assign_student_to_section`, `reassign_student_to_section`, `assign_class_teacher`, `end_class_teacher`, `assign_cr_designation`, `end_cr_designation`, `assign_lab_batch`, `unassign_lab_batch`, `search_assignable_students`, `get_my_section_teachers`, `get_test_questions`, `submit_test_attempt`, `mark_content_complete`, `global_search`, `study_outline`, `study_topic_context`, `smart_study_overview`, `notes_manager`, `notes_viewer`, `notes_object_manageable`, `notes_object_viewable`, `planner_can_manage`, `planner_student_can_see`, `planner_teacher_can_see`, `teacher_manages_subject`, `student_currently_in_section`, `student_currently_in_subject`, `is_current_cr_of_section` |
| `REVOKE … FROM public` + `GRANT … TO authenticated`, with `anon` revoked in an earlier migration but not repeated in the latest one (`20261021000000_assignment_system_reliability.sql`) | `teacher_has_section`, `teacher_has_subject_in_section`, `is_class_teacher_of_section` |
| `REVOKE … FROM public` + `GRANT … TO authenticated`; no `REVOKE … FROM anon` found | `teacher_has_subject` |
| `REVOKE` from `public`, `anon` and `authenticated` (not meant to be called by clients) | `award_achievement_if_earned`, `recalc_topic_progress`, `record_daily_activity`, `bootstrap_first_super_admin` |
| `REVOKE` from `anon` and `authenticated` | `validate_planner_event` |
| **No `REVOKE`/`GRANT` statement found** (non-trigger functions) | `current_role`, `is_admin`, `is_teacher_or_admin`, `get_subject_id_for_topic`, `student_enrolled_in_subject`, `content_file_authorized`, and the eight `analytics_*` functions |
| No statement found; trigger functions (not callable as RPCs) | `handle_new_user`, `protect_sensitive_user_columns`, `protect_attempt_scoring_columns`, `set_updated_at`, `enforce_single_current_academic_year`, `stamp_attendance_record`, `stamp_and_validate_ia_marks`, `trg_handle_student_assignment_change`, `trg_handle_user_role_change`, and the other `validate_*` functions |

Migration 21 (`20261101010000_21_assignment_concurrency_hardening.sql`) contains **no** GRANT/REVOKE; its header says it relies on `CREATE OR REPLACE FUNCTION` preserving existing ACLs. **[V]**

### 6.3 Effective live production function ACLs **[U — not verified]**
What a client can actually execute in production depends on the live ACLs, which combine the statements above, platform default privileges, function ownership, and any change made outside migrations. **None of this was inspected**, so no statement in this repository documentation may be read as "anon cannot execute X" or "anon can execute X" for production.

Related evidence, kept separate:
- The README and the older handoff say a few SECURITY DEFINER helper/trigger functions retain default `anon` EXECUTE and that Supabase advisors flag them, with no data exposure because they depend on `auth.uid()`. **[H]**
- For the five Migration 21 functions (`assign_student_to_section`, `reassign_student_to_section`, `assign_class_teacher`, `end_class_teacher`, `trg_handle_user_role_change`), the security audit verified owner `postgres`, `search_path = 'public'`, execute revoked from `PUBLIC`/`anon` and granted to `authenticated` on the **isolated local database**, not on production. **[R]**
- Whether to revoke `anon` EXECUTE on the helper functions is an open owner decision.

### 6.4 Helper-function and `anon` review notes (static, 2026-11-27) **[V static]**
Method: an in-order replay of function definitions and `GRANT`/`REVOKE` statements across all 59 migrations, applying statements in file order. It reproduces §6.1 exactly (70 functions: 54 SECURITY DEFINER, 16 SECURITY INVOKER, every one with a `search_path`). Nothing was run against any database.

- **Counts.** 36 functions have an explicit `REVOKE EXECUTE … FROM anon`. 34 have no statement about `anon`: 19 trigger functions and 15 others. The 15 are six SECURITY DEFINER helpers (`current_role`, `is_admin`, `is_teacher_or_admin`, `student_enrolled_in_subject`, `teacher_has_subject`, `get_subject_id_for_topic`) and nine SECURITY INVOKER functions (the eight `analytics_*` and `content_file_authorized`).
- **Platform defaults.** No migration contains `ALTER DEFAULT PRIVILEGES` or a table-level grant to `anon`, so what `anon` can actually execute depends on platform defaults. **[U]**
- **What an unauthenticated caller learns from the six helpers.** Five derive their answer from `auth.uid()` (`current_role()` selects `role from users where id = auth.uid()`; `is_admin` and `is_teacher_or_admin` build on it; the other two compare to `auth.uid()`), so with no session they return NULL or false and disclose nothing. **The exception is `get_subject_id_for_topic(uuid)`:** SECURITY DEFINER with no caller check, it returns the subject id for a topic id, bypassing RLS on `topics` and `units`. Sensitivity is low (opaque UUIDs only) but it is the one helper whose `anon` EXECUTE is not neutralised by `auth.uid()`.
- **The nine INVOKER functions** run under the caller's RLS.
- **Policies and `anon` (recounted 2026-11-27 over all 70 function names).** There are 125 final policies (109 on `public` tables and 16 on `storage.objects`). 121 have no `TO` clause and therefore apply to every role including `anon`; 4 are `TO authenticated`. 111 policies reference at least one of the 70 functions, and 107 of those have no `TO` clause. Policies referencing each of the seven helpers that have no explicit `anon` revoke (counted by function name in the policy text; helpers that call other helpers are not followed, so these are lower bounds): `is_admin` 93 (92 with no `TO` clause), `teacher_has_subject` 28, `get_subject_id_for_topic` 20, `is_teacher_or_admin` 9, `student_enrolled_in_subject` 8, `current_role` 4, `content_file_authorized` 1. 23 of the 121 no-`TO` policies reference none of these seven. A role needs EXECUTE on functions called inside a policy that applies to it **[A: standard PostgreSQL behaviour]**. Revoking `anon` EXECUTE on these helpers would therefore not open anything, but anonymous requests to tables whose policies reference them would fail with a permission error instead of returning no rows. The project already revoked `anon` on 36 functions, including many policy helpers (`teacher_has_section`, `planner_*`, `notes_*`), so the pattern is established. The counts come from a static parse of the migration SQL; the live policy set is not verified **[U]**.
- **Does the application need `anon` EXECUTE?** No call that needs it was found. The pre-login pages (`PortalLoginPage`, `PortalSelectionPage`, `ResetPasswordPage`, `ConfigNeededPage`) and `AuthContext` make no `rpc()` or function call, and all 18 RPC names the application calls (`analytics_admin_overview`, `assign_*`, `end_*`, `get_*`, `global_search`, `mark_content_complete`, `reassign_student_to_section`, `search_assignable_students`, `smart_study_overview`, `study_*`, `submit_test_attempt`, `unassign_lab_batch`) are used by signed-in roles. Login and recovery use the Auth API. **[V]**
- **The Class Teacher guard query is permitted by the existing policy.** `class_teacher_assignments_select` (`20260912064843…`, lines 143–152) allows `is_admin()`, `teacher_id = auth.uid()`, `teacher_has_section(section_id)`, or a student currently in the section; the guard reads only the caller's own rows. No later migration redefines it, and Migration 21 drops only the write policy. No database change was needed for the guard.
- **Not verified:** live ACLs and default privileges (S2). The decision whether to revoke `anon` EXECUTE is the owner's (`05-PROJECT-STATUS-AND-KNOWN-ISSUES.md` §7, item 4).

## 7. Edge Function: `admin-create-user` **[V]**

Single function in `supabase/functions/admin-create-user/index.ts`. Environment variables it reads (names only): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`.

Flow:
1. Rejects non-POST (405) and requests without an `Authorization` header (401).
2. Builds a client with the **caller's JWT** (`asAdmin`), calls `auth.getUser()`, then reads the caller's `users.role`; anything other than `super_admin` → 403.
3. Validates the body: role ∈ {`student`,`teacher`}; non-empty name; email format; temporary password **≥ 8 characters**; UUIDs for academic year, regulation, program, semester, section; subject for teachers; USN `^[A-Z0-9]{6,15}$` (students) or employee ID `^[A-Z0-9]{4,20}$` (teachers).
4. Checks email / USN / employee ID uniqueness using the caller's client.
5. Creates the Auth user with the **service-role client** (`email_confirm: true`, name/phone as metadata).
6. Updates the new `users` row (role, name, phone, USN/employee ID) and inserts the assignment (`student_assignments` or `teacher_assignments`) using the **caller's** client, so RLS and the `protect_sensitive_user_columns` guard still apply.
7. If step 6 fails, it deletes the new Auth user (best effort; the deletion's own errors are swallowed) and returns a friendly error.

Observations (not defects asserted — owner review items):

| # | Observation | Status |
|---|---|---|
| E1 | CORS `Access-Control-Allow-Origin: *`. The function still requires a valid super_admin JWT. | **[V]**; whether to restrict origins is a design decision |
| E2 | The student assignment is a direct `INSERT` into `student_assignments` with five client-supplied hierarchy IDs. It does not call `assign_student_to_section`, which derives year/regulation/program/semester from the section and (since Migration 21) takes the ordered row locks. No trigger or composite constraint tying the five IDs together on `student_assignments` was found in the migrations. | **[V static]**; whether production enforces consistency some other way is **[U]** |
| E3 | Creation is multi-step and not transactional; the compensating delete is best-effort. A failed compensating delete could leave an orphan Auth user. | **[V]** |
| E4 | There is no `[functions.admin-create-user]` block in `config.toml`; the README says to deploy it with `verify_jwt` enabled. The deployed state of the production function and its JWT-verification setting were not inspected. | **[U]** |
| E5 | Temporary-password minimum (8) differs from the local Auth minimum (6) and from any production policy. | **[V]** |

## 8. Storage security **[V]**

- `avatars` is intentionally public; writes are restricted to the user's own folder.
- `content-files` and `posters` are private. Reads are policy-scoped (`content_file_authorized`, `posters_authorized_read`); the client uses signed URLs.
- `notes_files_scoped_*` policies govern note attachments inside `content-files`.
- Poster paths in `announcements` and `planner_events` are constrained to relative paths in the `posters` bucket (CHECK constraints added in `20261015214500_event_announcement_posters.sql`).

## 9. Migration 21 security properties

What the source defines **[V]**:
- Serialization of student assignment, class-teacher assignment, class-teacher end, and teacher demotion by ordered row locks (users → sections by id → assignment rows).
- Direct-write bypass closed: `class_teacher_assignments_write_admin_only` is dropped; only `class_teacher_assignments_select` remains.
- The lock-order guarantee is limited to the audited paths; other write paths were not audited (stated in the migration header).
- **No rollback migration or script exists for Migration 21 in the repository.**

Four evidence classes, kept separate:

| Class | Statement | Tag |
|---|---|---|
| Committed and pushed | Migration 21 is on `main` (`6d55753`) | **[V]** |
| Isolated test evidence | Nine regression groups and five two-session concurrency scenarios passed on a disposable local database; security audit status "READY FOR PRODUCTION REVIEW" (explicitly not "production-approved") | **[R]** |
| Historical production verification | A read-only production catalog verification **dated 2026-11-14** reported that function bodies match the source, one SELECT policy remains, and the trigger is enabled | **[R]** |
| Current live production state | Not rechecked for this documentation | **[U]** |

## 10. Known limitations and open security questions

| ID | Item | Status |
|---|---|---|
| S1 | Production Auth settings (sign-up, redirect URLs, password policy, leaked-password protection) not verified | **[U]** |
| S2 | Live function ACLs (`anon` EXECUTE on helper functions) not verified | **[U]** |
| S3 | `verify_jwt` setting of the deployed Edge Function not verified | **[U]** |
| S4 | Student creation bypasses the hierarchy-deriving RPC (E2) | **[U]** |
| S5 | No automated security regression in CI; SQL tests are manual scripts | **[V]** |
| S6 | No Migration 21 rollback script | **[V]** |
| S7 | A report records the local Docker database published as `0.0.0.0:54322->5432/tcp` (all interfaces). The report does not call this a defect; whether to bind to loopback only is a local-hygiene decision | **[R]** |
| S8 | Repository is public (cloned anonymously). Existing handoff text includes a Supabase project reference; the untracked reports contain more infrastructure identifiers and should not be committed without review | **[V]/[O to decide]** |
| S9 | Unused legacy tables (reels, Virtual Lab) still carry RLS policies and attack surface | **[V]** |
| S10 | Backup and disaster recovery is **PAUSED INDEFINITELY**. It is not to be resumed unless the owner explicitly instructs it. Nothing from that workstream is summarized in this document | **[O]** |
