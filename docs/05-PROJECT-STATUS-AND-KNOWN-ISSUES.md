# ECE Hub Buddy — Project Status and Known Issues

> **Source baseline:** GitHub `main` @ `6d557533a7c26da3fc668ae7e6d1233148129e4c` (verified 2026-11-19; unchanged from the Migration 21 commit).
> **Tags:** **[V]** verified in tracked source/git · **[O]** owner-stated · **[R]** reported by an existing untracked report, not re-verified · **[H]** historical statement in an existing document · **[A]** assumption · **[U]** unresolved / unverified.
>
> This page separates *what is verified* from *what is reported* and *what is unknown*. Where documents disagree and the evidence does not settle it, the conflict is listed rather than silently resolved.

## 1. Baseline

| Item | Value |
|---|---|
| Authoritative source for tracked code | GitHub `main` @ `6d55753…` **[O]/[V]** |
| Commits on `main` | 41 (first: 2026-09-26; latest: 2026-11-14) **[V]** |
| Documentation set | The owner has approved adopting these six documents (`docs/README.md` and `docs/01`–`05`), subject to corrections; the revised files await final owner approval before being applied **[O]** |
| Other remote branches | All other remote branches are behind `main`. The one apparent exception, `feature/notes-module-chapter` (one commit ahead), is a rename-only change already on `main` as `a386a51` **[V]** |
| Handoff ZIP | Contains all 219 tracked files, identical to `main` apart from CRLF line endings, plus **nine** untracked files (§4.1) **[V]** |
| `Our-Littele-World-/` | Previously reported local material; **not** in the ZIP; not one of the nine (§4.2) **[R]** |
| Production | Not inspected for this document. Existing reports are cited only as **[R]** |

### 1.1 Pull requests #1–#12: what was and was not verified

Verified **[V]** from the cloned git history, individually per PR: `refs/pull/N/head` exists for N = 1…12 (none beyond 12), each head commit is an ancestor of `main`, and `main` contains a commit titled "Merge pull request #N from …".

| PR | Head commit | Head is an ancestor of `main` | Merge commit on `main` |
|---|---|---|---|
| #1 | `b7ad293` | yes | `dc46b8b` |
| #2 | `68e7789` | yes | `013442c` |
| #3 | `f391ec7` | yes | `363adbc` |
| #4 | `6406d47` | yes | `d7970c5` |
| #5 | `349eb44` | yes | `1f5da60` |
| #6 | `cce037c` | yes | `17d7b6d` |
| #7 | `939260d` | yes | `203d29e` |
| #8 | `4315174` | yes | `bfc5172` |
| #9 | `ea48a5d` | yes | `7a8ca08` |
| #10 | `191fbc6` | yes | `bef4737` |
| #11 | `185b171` | yes | `800d6a6` |
| #12 | `68946f2` | yes | `f75f593` |

This is git-level evidence consistent with each PR having been merged. It is **not** GitHub's own per-PR status field, and the PR discussion threads were **not** read: the GitHub API was rate-limited and the PR pages could not be parsed. **[U]** Descriptions of PRs in this document therefore refer to merge commits, not to reviewed PR threads.

## 2. Verified completed work (from git history and source) **[V]**

| Period | Work (commit evidence) |
|---|---|
| 2026-09-26 | Initial commit of the application (`dd22279`): application source, 48 migrations and the Edge Function `admin-create-user`. Production readiness is not independently evidenced here |
| 2026-09-29 | Self-service password change; password-recovery flow fix; admin student edit (delete deliberately deferred) |
| 2026-10-05/07 | Production-audit and timetable-conflict fixes; module chapter notes workflow (PR #1); filename alignment with production history (`a386a51`) |
| 2026-10-08/10 | Timetable redesign, 12-hour time, mobile layout, dual-batch scheduling (PRs #2–#6); notes uploader-name trigger fix (PR #5) |
| 2026-10-10/11 | App-wide sorting of hierarchy, rosters, filters and content (PRs #7–#9) |
| 2026-10-15 | Batched large content queries; load/data-fetch performance work (PRs #10–#11) |
| 2026-10-19 | Private event/announcement poster uploads (`posters` bucket) |
| 2026-10-22/25 | Assignment system reliability: reassignment RPCs, lab-batch unassign scoping, role-demotion cleanup trigger, regression tests and a rollback script (PR #12) |
| 2026-11-01 | **Migration 20** — advisory lock on first-super-admin bootstrap (`5b24d09`) |
| 2026-11-14 | **Migration 21** — assignment concurrency hardening + 1,567-line test suite (`6d55753`) |

Whether each feature works end to end, in production or anywhere else, is **[U]**; this table records what was committed.

## 3. Migration 20 and 21 status: four separate statements

| # | Statement | Evidence class |
|---|---|---|
| 1 | **Committed and pushed.** Migration 20 is on `main` (`5b24d09`, 2026-11-01); Migration 21 is on `main` (`6d55753`, 2026-11-14) | **[V]** |
| 2 | **Isolated test evidence.** 9 regression groups and 5 two-session concurrency scenarios passed on a disposable local database; the security audit status is "READY FOR PRODUCTION REVIEW", explicitly not "production-approved" | **[R]** `MIGRATION_21_ISOLATED_TEST_REPORT.md`, `MIGRATION_21_FINAL_SECURITY_AUDIT.md` |
| 3 | **Historical read-only production catalog verification dated 2026-11-14.** It reported that function bodies match the committed SQL, one SELECT policy remains on `class_teacher_assignments`, the trigger is enabled, and the two migration versions are in migration history | **[R]** `MIGRATION_21_PRODUCTION_CATALOG_VERIFICATION.md` |
| 4 | **Current live production state.** Not rechecked for this documentation. The owner has stated that Migration 21 is verified in production | **[U]** for the current state; **[O]** for the owner's statement |

Also:
- **Migration 21 has no rollback migration or script in the repository.** **[V]**
- When, how and by whom Migration 21 was applied to production is **[U]**: no document records it. Do not cite "2026-11-01 01:00:00 UTC" as an application time; it is the migration's version number.
- "Migration 20" and "Migration 21" here mean the files labelled `20` and `21` in their filenames. Header-only numbers on older files collide with these (see `02-DATABASE-AND-MIGRATIONS.md` §3).

## 4. Untracked local material — preserve **[O]**

### 4.1 Nine files in the handoff ZIP that are not on GitHub **[V]**

| Item | Notes |
|---|---|
| `MIGRATION_21_ENVIRONMENT_RECOVERY_REPORT.md` | Migration 21 workstream report |
| `MIGRATION_21_FINAL_HANDOFF_REPORT.md` | Written **before** the commit; says the files are not on `origin/main` (true at that time) |
| `MIGRATION_21_FINAL_SECURITY_AUDIT.md` | |
| `MIGRATION_21_ISOLATED_TEST_REPORT.md` | |
| `MIGRATION_21_PRODUCTION_CATALOG_VERIFICATION.md` | Historical read-only verification (2026-11-14) |
| `MIGRATION_21_PRODUCTION_PREFLIGHT_REPORT.md` | |
| `PRODUCTION_BACKUP_DISASTER_RECOVERY_AUDIT.md` | Part of the paused workstream — preserved untouched |
| `PRODUCTION_MANUAL_BACKUP_PLAN.md` | Part of the paused workstream — preserved untouched |
| `supabase/snippets/Untitled query 806.sql` | Byte-identical to tracked `supabase/tests/assignment_reliability_test_editor.sql` |

### 4.2 `Our-Littele-World-/` — previously reported local material, **not in the ZIP** **[R]**

Earlier reports list this folder as untracked in the owner's working directory. It was **not** included in the handoff ZIP, it is **not** one of the nine files above, and its contents are unknown. Its existence is taken from those reports and was not independently observed. It must not be deleted or discarded. **[O]**

The repository is public. Several of the nine files include infrastructure identifiers. Whether to commit any of them is an owner decision that should follow a redaction review. **[U]**

## 5. Backup and disaster recovery — PAUSED INDEFINITELY **[O]**

Backup and disaster recovery is paused indefinitely. It is not to be resumed unless the owner explicitly instructs it. The two existing reports are preserved untouched. This documentation set does not inspect, summarize, revise or implement that workstream.

## 6. Documentation conflicts ledger

"Resolved" means the tracked source settles it; "Open" means the evidence does not.

| ID | Document says | Evidence | Status | Proposed correction (not applied) |
|---|---|---|---|---|
| C1 | README: migrations "numbered `01`–`19` first, then timestamped files" | All 59 SQL files are timestamp-prefixed since `a386a51` | **Resolved** by source | Describe the `<timestamp>_<label>.sql` convention and that labels are not the ordering key |
| C2 | README: buckets are `avatars` and `content-files` | A third private bucket `posters` exists (`20261015214500…`) | **Resolved** | Add `posters` |
| C3 | HANDOFF: "46 migrations … 43 public tables … ~106 policies"; "(47 migrations)" at §24 | 59 SQL files; 44 tables; static replay 109 public + 16 storage policies | **Resolved** (counts are from static replay; live counts not queried) | Replace with current counts and a dated "as of" note |
| C4 | HANDOFF §24: local matches live "through `20260925160127_admin_user_management_employee_id`" | Repo file is `20260925160114_admin_user_management_employee_id.sql`; commit `a386a51` later aligned filenames with production history | **Open** | Owner-run read-only `supabase migration list` comparison would settle it. The alignment commit makes a rename the likely explanation **[A]** |
| C5 | HANDOFF/README: migration state ends at 19 or 47 | Migrations 20 and 21 exist | **Resolved** | Update |
| C6 | HANDOFF §27: "main JS chunk >500 kB" | Pages are lazy-loaded (`lazyNamed`); current chunk sizes were not measured | **Open** | Re-measure with `npm run build` before keeping the claim |
| C7 | HANDOFF §27: manual test announcements ("Cr test", "Test admin") in the live DB | Not verifiable from source | **Open** | Owner decision |
| C8 | README "Known limitations": no automated test suite | Accurate for the application; SQL test scripts exist and `npm run lint` exists but is undocumented | **Partly stale** | Mention `supabase/tests/` and lint |
| C9 | README: BioVerse mentioned only in historical migration comments | Also in `ProtectedRoute.tsx`, `ConfigNeededPage.tsx`, HANDOFF §30, `00_MIGRATION_PLAN.md` | **Resolved** (minor) | Broaden the sentence or leave as-is |
| C10 | `00_MIGRATION_PLAN.md`: "Not executed. No Supabase project created or connected" | The repository now contains 59 SQL migrations, and the tracked handoff describes a connected project **[H]**; the plan describes the pre-implementation state | **Resolved** (historical document) | Mark the file historical |
| C11 | `00_MIGRATION_PLAN.md`: `announcements.scope_type` is `all`, `section`, `subject`; Virtual Lab scoring via a service-role Edge Function | Actual `scope_type`: `all, academic_year, regulation, program, semester, section`; the only Edge Function is `admin-create-user`; Virtual Lab has no UI | **Resolved** | Mark the plan historical |
| C12 | Migration 21 preflight names the trigger `trg_user_role_change` | Source and catalog report: `trg_user_role_change_assignment_cleanup` (defined in `20261021000000…`) | **Resolved** by source | Use the source name |
| C13 | Migration 21 header/reports call `assignment_system_reliability` "Migration 19"; several older files carry header numbers 20, 20b, 21, 22–25 and `15b` says "16" | Filename label `19` is `first_super_admin_bootstrap`; filename labels `20`/`21` are the two 2026-11-01 files, which collide with the header-only "Migration 20"/"Migration 21" on `20260910154057_teacher_student_assignment.sql` and `20260912064843_academic_operations_foundation.sql` | **Open** (naming) | Refer to migrations by full filename or 14-digit version; see `02-DATABASE-AND-MIGRATIONS.md` §3 |
| C14 | Catalog report: `num_statements: 6` for Migration 21 | Source has 5 top-level statements | **Open** (counting method unknown) | Note, do not "fix" |
| C15 | Environment-recovery report: "58 pre-requisite migrations … through `20261021…`" | 57 SQL files precede `20261101000000` | **Open** (minor; may count differently) | Note |
| C16 | Final-handoff report: Migration 21 files not on `origin/main`; preflight: contained in `6d55753` | Commit `6d55753` is dated 2026-11-14 and is the tip of `main` | **Resolved** as a timeline difference | Add dates to reports if they are ever published |
| C17 | Earlier summaries cite "applied at 2026-11-01 01:00:00 UTC" | That is the version number | **Resolved** | Do not use it as an apply time |

## 7. Unresolved decisions (owner)

1. Whether to add a rollback script for Migration 21, and whether the existing rollback for `20261021000000_assignment_system_reliability.sql` is still safe to keep or must be updated.
2. How to name and number migrations going forward (the numbering conflicts in `02-DATABASE-AND-MIGRATIONS.md` §3).
3. What to do with the unused Virtual Lab and Reels tables.
4. Whether to revoke `anon` EXECUTE on the helper functions listed in `03-SECURITY-AND-ACCESS-CONTROL.md` §6.2, after live ACLs have been checked.
5. Production Auth settings: public sign-up, leaked-password protection, redirect URLs.
6. Whether the Edge Function should create students through `assign_student_to_section` (`03-SECURITY-AND-ACCESS-CONTROL.md`, E2), and whether to restrict CORS.
7. Which of the nine untracked ZIP files (if any) become tracked, after redaction review.
8. A separately reviewed and validated procedure for setting up a fresh Supabase project from the migrations (none exists; see `04-DEVELOPMENT-AND-DEPLOYMENT.md` §3.1).
9. Test and CI strategy (currently none).
10. Test-data announcements and any other manual data in production.
11. Which Node version to pin.

## 8. Known issues and limitations

| ID | Item | Status |
|---|---|---|
| K1 | No application tests, no CI | **[V]** |
| K2 | SQL tests are manual and target isolated databases | **[V]/[R]** |
| K3 | Migration 21 has no rollback | **[V]** |
| K4 | Student creation inserts hierarchy IDs directly (`03-SECURITY-AND-ACCESS-CONTROL.md`, E2) | **[V static]** |
| K5 | Production Auth/ACL/`verify_jwt` settings unverified | **[U]** |
| K6 | Unused legacy tables | **[V]** |
| K7 | Hosting provider and URL undocumented | **[U]** |
| K8 | Stale README/HANDOFF/PLAN documents (§6) | **[V]** |
| K9 | Local project label `ECE-HUB-BUDDY-PRODUCTION` in `config.toml` can be mistaken for production | **[V]** |
| K10 | Lock-order guarantee of Migration 21 is limited to audited paths | **[V]** |

## 9. Future review tasks (proposals only — none approved)

1. Owner-run read-only `supabase migration list` and catalog comparison to confirm migration versions, policy counts, **effective live function ACLs** and Edge Function settings (C4, S1–S3).
2. Edge Function review of the student-creation path against the assignment RPCs (K4).
3. Chunk-size measurement via `npm run build` (C6).
4. Drafting a Migration 21 rollback *proposal* for review (K3).
5. Redaction review of the nine untracked ZIP files.
6. Applying the approved documentation set to the repository, which requires the owner's final approval of these revised files.
7. Reading the 12 pull-request discussion threads and GitHub's per-PR status fields, if their content matters.

## 10. Facts that remain unverified

- Current live production state (last historical check: the read-only catalog verification dated 2026-11-14 **[R]**); live policy/function counts; **effective live function ACLs**; Auth settings; Edge Function deployment state and JWT verification.
- When and by whom Migration 21 was applied.
- Hosting provider, domain, Node version.
- Contents and current existence of `Our-Littele-World-/`; local uncommitted work after the ZIP was built.
- End-to-end behaviour of every feature.
- GitHub's per-PR status fields and the discussions of PRs #1–#12 (git-level evidence only; §1.1).
