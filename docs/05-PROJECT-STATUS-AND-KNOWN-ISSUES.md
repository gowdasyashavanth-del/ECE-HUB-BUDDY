# ECE Hub Buddy — Project Status and Known Issues

> **Source baseline:** GitHub `main` @ `a5c8b3e97c72066119eb6a76db4387c6e3d00566` (verified 2026-11-27). Database facts are unchanged since the Migration 21 commit `6d55753`: no file under `supabase/` differs between the two.
> **Tags:** **[V]** verified in tracked source/git · **[O]** owner-stated · **[R]** reported by an existing untracked report, not re-verified · **[H]** historical statement in an existing document · **[A]** assumption · **[U]** unresolved / unverified.
>
> This page separates *what is verified* from *what is reported* and *what is unknown*. Where documents disagree and the evidence does not settle it, the conflict is listed rather than silently resolved.

## 1. Baseline

| Item | Value |
|---|---|
| Authoritative source for tracked code | GitHub `main` @ `a5c8b3e…` (2026-11-25) **[O]/[V]** |
| Commits on `main` | 45 (first: 2026-09-26; latest: 2026-11-25) **[V]** |
| Documentation set | These six documents were added to `main` in `f8acac6` (2026-11-21) and revised on 2026-11-27 to the `a5c8b3e` baseline (§11) **[V]** |
| Other remote branches | Re-verified 2026-11-27 (§11.1): every other remote branch, including all four timetable branches, is an ancestor of `main`. The one apparent exception, `feature/notes-module-chapter` (one commit ahead), is patch-equivalent to `a386a51`, already on `main` **[V]** |
| Handoff ZIP | Contains all 219 tracked files, identical to `main` apart from CRLF line endings, plus **nine** untracked files (§4.1) **[V]** |
| `Our-Littele-World-/` | Previously reported local material; **not** in the ZIP; not one of the nine (§4.2) **[R]** |
| Production | Not inspected for this document. Existing reports are cited only as **[R]** |

### 1.1 Pull requests #1–#13: what was and was not verified

Verified **[V]** from the cloned git history, individually per PR: `refs/pull/N/head` exists for N = 1…13 (none beyond 13; re-confirmed with `git ls-remote` on 2026-11-27), each head commit is an ancestor of `main`, and `main` contains a commit titled "Merge pull request #N from …".

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
| #13 | `39dab96` | yes | `a5c8b3e` |

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
| 2026-11-21 | Reference documentation set added (`docs/README.md`, `01`–`05`) (`f8acac6`) |
| 2026-11-22 | Form-field readability across Light, Dark and Eye Care: field tokens, per-theme `color-scheme`, zero-specificity base layer, copper-button text contrast (`85d4326`) |
| 2026-11-25 | Class Teacher-only navigation and route protection: shared `ClassTeacherProvider`, `ClassTeacherRoute`, sidebar visibility, redirect notice (PR #13, head `39dab96`, merged as `a5c8b3e`) |
| 2026-11-27 | Project-health review (§11): documentation corrected to `a5c8b3e`; Vitest + Testing Library suite and a hardened GitHub Actions CI workflow added. No application source file is changed. Recorded here because it ships in the same change as this page |

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
| C1 | README: migrations "numbered `01`–`19` first, then timestamped files" | All 59 SQL files are timestamp-prefixed since `a386a51` | **Resolved** by source; README corrected 2026-11-27 | Done: README now describes the `<timestamp>_<label>.sql` convention and that labels are not the ordering key |
| C2 | README: buckets are `avatars` and `content-files` | A third private bucket `posters` exists (`20261015214500…`) | **Resolved** | Add `posters` |
| C3 | HANDOFF: "46 migrations … 43 public tables … ~106 policies"; "(47 migrations)" at §24 | 59 SQL files; 44 tables; static replay 109 public + 16 storage policies | **Resolved** (counts are from static replay; live counts not queried) | Replace with current counts and a dated "as of" note |
| C4 | HANDOFF §24: local matches live "through `20260925160127_admin_user_management_employee_id`" | Repo file is `20260925160114_admin_user_management_employee_id.sql`; commit `a386a51` later aligned filenames with production history | **Open** | Owner-run read-only `supabase migration list` comparison would settle it. The alignment commit makes a rename the likely explanation **[A]** |
| C5 | HANDOFF/README: migration state ends at 19 or 47 | Migrations 20 and 21 exist | **Resolved** | Update |
| C6 | HANDOFF §27: "main JS chunk >500 kB" | Pages are lazy-loaded (`lazyNamed`). Measured with `npm run build` at `a5c8b3e` on 2026-11-27: largest JS chunk `vendor-supabase` 220.43 kB (57.64 kB gzip); `vendor-react` 165.24 kB (53.80 kB gzip); entry chunk `index` 87.06 kB (23.53 kB gzip); no chunk reaches 500 kB; PWA precache 89 entries, 1510.07 KiB | **Resolved** — the claim does not hold at this commit | None; the HANDOFF stays historical |
| C7 | HANDOFF §27: manual test announcements ("Cr test", "Test admin") in the live DB | Not verifiable from source | **Open** | Owner decision |
| C8 | README "Known limitations": no automated test suite | Was accurate for the application when written. Now: a Vitest suite (`npm test`) and CI workflow are added in this change; SQL test scripts remain manual; `npm run lint` exists | **Resolved**; README corrected 2026-11-27 | Done: README documents `npm run lint`, `npm test`, CI and the SQL scripts |
| C9 | README: BioVerse mentioned only in historical migration comments | Also in `ProtectedRoute.tsx`, `ConfigNeededPage.tsx`, HANDOFF §30, `00_MIGRATION_PLAN.md` | **Resolved** (minor) | Broaden the sentence or leave as-is |
| C10 | `00_MIGRATION_PLAN.md`: "Not executed. No Supabase project created or connected" | The repository now contains 59 SQL migrations, and the tracked handoff describes a connected project **[H]**; the plan describes the pre-implementation state | **Resolved** (historical document) | Mark the file historical |
| C11 | `00_MIGRATION_PLAN.md`: `announcements.scope_type` is `all`, `section`, `subject`; Virtual Lab scoring via a service-role Edge Function | Actual `scope_type`: `all, academic_year, regulation, program, semester, section`; the only Edge Function is `admin-create-user`; Virtual Lab has no UI | **Resolved** | Mark the plan historical |
| C12 | Migration 21 preflight names the trigger `trg_user_role_change` | Source and catalog report: `trg_user_role_change_assignment_cleanup` (defined in `20261021000000…`) | **Resolved** by source | Use the source name |
| C13 | Migration 21 header/reports call `assignment_system_reliability` "Migration 19"; several older files carry header numbers 20, 20b, 21, 22–25 and `15b` says "16" | Filename label `19` is `first_super_admin_bootstrap`; filename labels `20`/`21` are the two 2026-11-01 files, which collide with the header-only "Migration 20"/"Migration 21" on `20260910154057_teacher_student_assignment.sql` and `20260912064843_academic_operations_foundation.sql` | **Open** (naming) | Refer to migrations by full filename or 14-digit version; see `02-DATABASE-AND-MIGRATIONS.md` §3 |
| C14 | Catalog report: `num_statements: 6` for Migration 21 | Source has 5 top-level statements | **Open** (counting method unknown) | Note, do not "fix" |
| C15 | Environment-recovery report: "58 pre-requisite migrations … through `20261021…`" | 57 SQL files precede `20261101000000` | **Open** (minor; may count differently) | Note |
| C16 | Final-handoff report: Migration 21 files not on `origin/main`; preflight: contained in `6d55753` | Commit `6d55753` is dated 2026-11-14 and was the tip of `main` at that time (`main` has since advanced; §1) | **Resolved** as a timeline difference | Add dates to reports if they are ever published |
| C17 | docs/02, docs/03: 59 migrations, 70 functions (54 SECURITY DEFINER / 16 INVOKER), 125 policies | An independent in-order replay of the SQL on 2026-11-27 reproduces all three; no file under `supabase/` changed since `6d55753` | **Confirmed** | None |
| C18 | docs/01, docs/04, docs/05: "no application tests, no CI", "PRs #1–#12 only", "41 commits", baseline `6d55753` | Now 45 commits, PR #13 merged, a Vitest suite and CI workflow added in this change, baseline `a5c8b3e` | **Resolved** by this change | Done in `docs/README.md` and `01`–`05` |
| C17 | Earlier summaries cite "applied at 2026-11-01 01:00:00 UTC" | That is the version number | **Resolved** | Do not use it as an apply time |

## 7. Unresolved decisions (owner)

1. Whether to add a rollback script for Migration 21. Finding (`02` §5.3.1): the existing rollback for `20261021000000_assignment_system_reliability.sql` is **not** safe to run against the current database and application, because it drops RPCs the application calls and does not cover Migration 21. It should be kept only with a clear "do not run after Migration 21" warning or replaced. Migration 21 itself changes no data; see §11.2 for the options.
2. How to name and number migrations going forward (the numbering conflicts in `02-DATABASE-AND-MIGRATIONS.md` §3).
3. What to do with the unused Virtual Lab and Reels tables.
4. Whether to revoke `anon` EXECUTE on the helper functions listed in `03-SECURITY-AND-ACCESS-CONTROL.md` §6.2, after live ACLs have been checked. Findings (`03` §6.4): no application call needs it; five of the six DEFINER helpers without an explicit revoke disclose nothing to an unauthenticated caller, and `get_subject_id_for_topic` is the one that does not check the caller; 36 functions already revoke `anon`.
5. Production Auth settings: public sign-up, leaked-password protection (`03` §2.1: Pro plan and above; the application maps the rejection on password change but ignores the weak-password notice returned at sign-in), redirect URLs.
6. Whether the Edge Function should create students through `assign_student_to_section` (`03-SECURITY-AND-ACCESS-CONTROL.md`, E2), and whether to restrict CORS.
7. Which of the nine untracked ZIP files (if any) become tracked, after redaction review.
8. A separately reviewed and validated procedure for setting up a fresh Supabase project from the migrations (none exists; see `04-DEVELOPMENT-AND-DEPLOYMENT.md` §3.1).
9. Test and CI strategy: a Vitest suite and CI workflow are proposed in this change (§11.3). Decide whether to merge them, require CI through branch protection, and whether to add end-to-end tests; also decide how to treat the dev-tooling advisories in §11.4.
10. Test-data announcements and any other manual data in production.
11. Which Node version to pin (CI uses 22).

## 8. Known issues and limitations

| ID | Item | Status |
|---|---|---|
| K1 | Application tests are mocked unit/component tests only (no end-to-end tests, no database tests in CI); the CI workflow exists but has not been observed running on GitHub | **[V]** |
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
3. Chunk-size measurement via `npm run build` (C6) — done 2026-11-27.
4. Drafting a Migration 21 rollback *proposal* for review (K3).
5. Redaction review of the nine untracked ZIP files.
6. Applying the documentation set — done (`f8acac6`); the 2026-11-27 revisions need the owner's review.
7. Reading the 13 pull-request discussion threads and GitHub's per-PR status fields, if their content matters.

## 10. Facts that remain unverified

- Current live production state (last historical check: the read-only catalog verification dated 2026-11-14 **[R]**); live policy/function counts; **effective live function ACLs**; Auth settings; Edge Function deployment state and JWT verification.
- When and by whom Migration 21 was applied.
- Hosting provider, domain, Node version; whether the new CI workflow passes on GitHub (it has only been validated with `actionlint` and by running its commands locally).
- Contents and current existence of `Our-Littele-World-/`; local uncommitted work after the ZIP was built.
- End-to-end behaviour of every feature.
- GitHub's per-PR status fields and the discussions of PRs #1–#13 (git-level evidence only; §1.1).

## 11. Project-health review (2026-11-27)

A read-only investigation plus repository-level improvements, done on a local branch based on `main` @ `a5c8b3e`. Nothing was pushed, merged or deployed; no Supabase setting, function, policy, migration or data was touched; no SQL was run. Findings are separated from recommendations; recommendations need owner approval (§11.5).

### 11.1 Remote branches, including the timetable branches **[V]**
The premise that timetable work might be unmerged does not hold: every timetable branch tip is an ancestor of `main`. Checked with `git rev-list`, `git merge-base --is-ancestor`, `git cherry`, `git merge-tree --write-tree` (conflict test) and a match of each tip against `refs/pull/N/head`.

| Branch | Tip | Tip date | Ahead / behind `main` | PR head | Ancestor of `main` | Merge with `main` |
|---|---|---|---|---|---|---|
| `feature/timetable-redesign-12h` | `68e7789` | 2026-10-08 | 0 / 35 | #2 | yes | no conflict |
| `feature/timetable-overlap-and-mobile-redesign` | `f391ec7` | 2026-10-08 | 0 / 33 | #3 | yes | no conflict |
| `fix/timetable-contrast-and-mobile-layout` | `6406d47` | 2026-10-08 | 0 / 31 | #4 | yes | no conflict |
| `feat/timetable-teacher-labs-and-simultaneous-batches` | `cce037c` | 2026-10-10 | 0 / 27 | #6 | yes | no conflict |
| `fix/notes-upload-display-name-trigger` | `349eb44` | 2026-10-09 | 0 / 29 | #5 | yes | no conflict |
| `fix/app-wide-sorting-phase-a` | `939260d` | 2026-10-10 | 0 / 25 | #7 | yes | no conflict |
| `fix/roster-sorting-phase-b` | `4315174` | 2026-10-11 | 0 / 23 | #8 | yes | no conflict |
| `fix/academic-content-sorting-phase-c` | `47b4e5e` | 2026-10-19 | 0 / 14 | none | yes | no conflict |
| `fix/assignment-system-reliability` | `68946f2` | 2026-10-25 | 0 / 7 | #12 | yes | no conflict |
| `feat/class-teacher-nav-visibility` | `39dab96` | 2026-11-25 | 0 / 1 | #13 | yes | no conflict |
| `feature/notes-module-chapter` | `445f9a9` | 2026-10-07 | 1 / 38 | none | no | no conflict |

- The four timetable branches carry no unique work and conflict with nothing. Their work was merged through PRs #2, #3, #4 and #6, and the timetable source is on `main` (`AdminTimetablePage`, `TeacherTimetablePage`, `StudentTimetablePage`, `timetableSlots`, `timetableValidation`, `timeFormat` and the timetable migrations).
- `feature/notes-module-chapter` has one commit (`445f9a9`) that `git cherry` reports as patch-equivalent to `a386a51`, which is already on `main`; its work is incorporated, it only shows as "ahead" because the commit hash differs.
- No branch appears abandoned with unmerged work. Ten branches are fully merged and could be deleted by the owner; none was deleted, rebased, merged or pushed.

### 11.2 Database and security review (read-only, static) **[V static]**
Details are in `02` §5.3.1, `03` §2.1 and `03` §6.4; evidence is the SQL text only.
- **Migration 21** changes no data (four `CREATE OR REPLACE FUNCTION`, one `DROP POLICY`). There is no data-loss risk in applying or reverting it. Reverting would re-open direct admin writes on `class_teacher_assignments` and remove the ordered row locking. The existing rollback script for the earlier migration must not be run after it. Options for the owner (proposal only): (a) prefer a forward-fix migration if a defect is ever found; (b) if a rollback is wanted, write and test it against an isolated database, restoring the four functions from `20261021000000…` and `20260912064843…`, and treat recreating the dropped policy as a deliberate decision; (c) record in the repository that the older script is not valid after Migration 21. No rollback SQL was written.
- **`anon` EXECUTE:** not needed by the application (no pre-login RPC use). Of 70 functions, 36 explicitly revoke `anon`; the 34 others are 19 triggers and 15 helpers. `get_subject_id_for_topic` is the one SECURITY DEFINER helper that does not check the caller. 121 of 125 policies apply to `anon`, so a revoke would turn anonymous table requests into permission errors rather than empty results. Verify live ACLs first (S2).
- **Leaked-password protection:** a Pro-plan Auth setting (vendor documentation, `03` §2.1). The application maps the rejection on password change to a friendly message and ignores the notice returned at sign-in for existing weak passwords. Production state is unknown (S1).

### 11.3 Tests and CI **[V]**
- **Added:** Vitest 3 + jsdom + Testing Library as dev dependencies; `npm test` and `npm run test:watch`; `vitest.config.ts` (separate from the production Vite config); 8 test files with 67 tests (`04` §6.1); an npm `overrides` entry pinning `tinypool` to 2.1.2 (§11.4); `.github/workflows/ci.yml` running `npm ci --ignore-scripts`, typecheck, lint, test and build with read-only permissions, no secrets, no deploy step, a checkout that does not persist credentials, and cancellation of superseded runs for pull requests only.
- **What they cover:** the password-change and recovery flows, `ProtectedRoute` (signed-out, wrong role, profile error, Super Admin), `ClassTeacherContext` (query shape, states, retry, stale-result reset, late responses), `ClassTeacherRoute`, the redirect notice, `Sidebar` visibility, timetable clash rules, and time formatting.
- **Meaningfulness check:** 12 deliberate breakages (for example removing a guard or a filter) were each caught by at least one test; the files were then restored. This was manual and is not in the repository.
- **No application source file is changed.** A review found one robustness gap that is **not** fixed here: in `ClassTeacherContext.tsx`, if the assignment query *throws* instead of returning an error, the provider stays on "loading" and the Class Teacher guard shows its checking state indefinitely. Access is never granted in that case, so this is a usability gap, not an authorization one. A 12-line fix and its test were prepared and are held back for separate approval (§11.5, item 2); until then the suite deliberately has no test for the thrown-query case.
- **Timetable lab detection:** `isLabSubject` (`src/lib/timetableValidation.ts:49–54`) also matches subject *codes* with a loose pattern (an "L" ending the code or followed by a digit), and the repository documents no code convention. Its test therefore asserts name-based detection and the ordinary-theory-subject negative only; code-based detection is deliberately not asserted so the test does not pin accidental behaviour.
- **Build output:** the test files live under `src/`, which Tailwind scans for class names. The identifier `container` (from Testing Library's `render()` result) makes Tailwind emit its unused `.container` rule and breakpoints: +298 bytes of CSS (40,386 to 40,684 bytes) and no JavaScript change. Because the stylesheet's hashed file name is referenced by every lazy chunk, 61 of the 84 built files get new hashed names on the next build (users re-download them once). Excluding test files from the `content` list in `tailwind.config.js` (line 15) restores a byte-identical production build (verified: 84 of 84 files); that one-line change is held for separate approval (§11.5, item 9).
- **Not covered:** behaviour against a real Supabase project, SQL/RLS tests in CI, visual regression, and end-to-end browser flows. Recommended next steps if wanted: run the existing SQL test scripts against a disposable local database in CI, and add a small browser test with mocked network for the sign-in and role-routing flows.
- **Limits:** the workflow itself has not run on GitHub; it was checked with `actionlint` and by running the same commands locally, including a clean-room install with `npm ci --ignore-scripts`.

### 11.4 Dependency advisories (`npm audit`) **[V]**
- **Baseline `main`:** 14 advisories (1 low, 10 moderate, 3 high, 0 critical). The production dependency tree has two, both moderate, on `react-router` / `react-router-dom` 6.30.6: an open redirect through a backslash in `<Link>` / `useNavigate` (GHSA-wrjc-x8rr-h8h6) and constructor injection during SSR hydration (GHSA-337j-9hxr-rhxg). The application is a client-side SPA with no server rendering, so the second is not applicable **[A]**. The fix is react-router-dom 7.x, a major upgrade that was **not** applied.
- **After adding the test tooling (Option A):** 16 advisories (1 low, 12 moderate, 3 high, **0 critical**) against 14 on `main`; the production-only audit is unchanged (2 moderate, `react-router`). An earlier draft of this change, without the override below, had 17 advisories including 2 critical. The two entries the tooling adds are dev-only (87 packages added, all flagged `dev` in the lockfile, none shipped): `vitest` and `@vitest/mocker`, both moderate: a path-traversal / arbitrary-file-read advisory through the redirect mock (GHSA-82fw-gwwq-j7x9) and a code-injection advisory through unauthenticated manual mock registration (GHSA-qxg6-89mg-rqv8). Both need attacker-controlled mock registrations, which do not exist in `vitest run` over this repository's own tests **[A]**. They are fixed only in Vitest ≥ 4.1.12 (the audit suggests 5.1.2), which requires Vite 6 or newer; that upgrade was not done.
- **`tinypool` override.** Vitest 3.2.7 declares `tinypool ^1.1.1`, which is affected by two critical advisories (GHSA-85c8-ppgw-ccpr and GHSA-5gmw-xhrv-c9v3, both fixed in 2.1.2): prototype-pollution gadgets that need a separate prototype-pollution primitive in the same process. `package.json` therefore pins `"overrides": {"tinypool": "2.1.2"}`. Verified: clean `npm ci`, all tests passing under the `forks`, `threads` and `vmThreads` pools, and typecheck, lint and build unchanged. This is an off-spec pairing (Vitest 3.2.7 was not built against tinypool 2.x): remove the override when Vitest is upgraded, and re-check after any Vitest bump.
- **Not adopted:** Vite 6.4.6 with Vitest 5.1.2 passed the same checks in a scratch copy (0 critical, 12 advisories, because it also clears the `vite` and `esbuild` advisories), but it is a build-tool major upgrade, Vitest 5 needs Node 22.12 or newer, and the application would need a regression pass. It is left for separate approval (§11.5, item 3). Do not run `vitest --ui` or `--api` on a shared network.

### 11.5 Items that need the owner's approval
1. Adopt the tests, CI workflow and documentation changes (this branch), including the dev dependencies and their advisories (§11.4).
2. The `ClassTeacherContext` robustness fix (a thrown assignment query currently leaves the provider on "loading"; §11.3). Prepared but **not** included in this change.
3. Upgrades that would clear the remaining advisories: react-router 7 (production); Vite 6.4.6 with Vitest 5.1.2 (dev tooling, validated in a scratch copy, §11.4).
4. Migration 21 rollback strategy (§11.2, decision 1).
5. Revoking `anon` EXECUTE on the six helpers, especially `get_subject_id_for_topic`, in a new reviewed migration with tests, after the live ACLs are checked.
6. Enabling leaked-password protection (needs the Pro plan; test on a non-production project first, including password reset, admin-created accounts and sign-in of existing weak-password users), and whether to surface the sign-in weak-password notice or improve the "too weak" message for breached passwords.
7. Branch protection that requires CI on pull requests; deleting the ten fully merged remote branches.
8. Whether `§4` (the nine untracked ZIP files and `Our-Littele-World-/`) is still current, given that a newer ZIP may no longer contain them.
9. Excluding test files from the `content` list in `tailwind.config.js` (line 15) so the production build stays byte-identical to `main` (§11.3, "Build output").
