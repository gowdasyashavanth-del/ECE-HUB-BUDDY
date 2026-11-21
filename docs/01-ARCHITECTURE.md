# ECE Hub Buddy — Master Project Architecture

> **Source baseline:** GitHub `main` @ `6d557533a7c26da3fc668ae7e6d1233148129e4c` (verified 2026-11-19).
> **Evidence tags:** **[V]** verified in tracked source at the baseline SHA · **[O]** stated by the project owner · **[R]** reported by an existing untracked report, not re-verified here · **[H]** historical · **[A]** assumption · **[U]** unresolved / unverified.

---

## 1. Purpose and project boundaries

ECE Hub Buddy is an academic management and learning portal for the Electronics & Communication Engineering (ECE) department. **[O]** It is an ECE-only portal for BGSIT Autonomous. The tracked README names the institution as BGS Institute of Technology (BGSIT). **[V]**

Boundaries that must be preserved **[O]**:

| Boundary | Detail |
|---|---|
| Roles | Exactly three: `super_admin`, `teacher`, `student` |
| Academic hierarchy | Academic year → regulation → program → semester → section → subject → unit → topic → content |
| Excluded features | No Branch entity, no Payment/subscription features, no KCET or NEET features |

Source check **[V]**: no `branches`, `payments` or `subscriptions` table exists in any migration. The strings "KCET"/"NEET" appear only in negations (the Migration plan and a comment in `20260912064843_academic_operations_foundation.sql`: "no Branch/payments/KCET/NEET").

## 2. Technology stack **[V]**

Versions below are the ranges in `package.json`; exact pins are in `package-lock.json`.

| Layer | Technology |
|---|---|
| UI framework | React `^18.3.1`, TypeScript `^5.5.3` |
| Build | Vite `^5.4.1`, `@vitejs/plugin-react` |
| Styling | Tailwind CSS `^3.4.13`, PostCSS, Autoprefixer |
| Routing | React Router `^6.26.2` (`BrowserRouter` in the normal build, `HashRouter` in the single-file build) |
| Backend | Supabase via `@supabase/supabase-js ^2.45.4` — Auth, Postgres (RLS + RPCs), Storage, one Edge Function |
| PWA | `vite-plugin-pwa ^0.21.2` (normal build only) |
| Single-file build | `vite-plugin-singlefile ^2.3.3` |
| Tooling | ESLint 8 (`npm run lint`), `tsc` typecheck (`npm run typecheck`) |
| Tests | **No application test runner.** SQL test scripts exist under `supabase/tests/` (see `04-DEVELOPMENT-AND-DEPLOYMENT.md`). |
| CI | **None in the repository** (no `.github/` directory). |
| Node version | Not pinned (`package.json` has no `engines` field; no `.nvmrc`). **[U]** which Node version is intended |

## 3. System overview

```
 Browser (React SPA, PWA-installable)
   │  supabase-js (anon/publishable key only; user JWT after login)
   ▼
 Supabase project
   ├─ Auth            email + password
   ├─ PostgREST       tables, filtered by Row Level Security
   ├─ Postgres RPCs   SECURITY DEFINER / INVOKER functions (scoring, search, assignment, analytics…)
   ├─ Storage         buckets: avatars (public), content-files (private), posters (private)
   └─ Edge Function   admin-create-user  (the only use of the service-role key)
```

Key design property **[V]**: there is no custom application server. Authorization is enforced in Postgres (RLS policies and RPCs). Frontend route guards only decide what the UI shows.

## 4. Repository layout **[V]**

```
index.html, index.singlefile.html     entry HTML (normal / single-file)
vite.config.ts, vite.config.singlefile.ts, vercel.json
public/                               favicons, PWA icons (192, 512, maskable, apple-touch)
src/
  main.tsx                            BrowserRouter entry
  main.singlefile.tsx                 HashRouter entry (portable build)
  App.tsx                             route table, lazy-loaded pages, global PWA UI
  contexts/                           AuthContext, ThemeContext
  hooks/                              useDebounce, usePWAInstall, usePWAUpdate
  lib/                                supabaseClient, analytics, planner, globalSearch, study,
                                      smartStudy, posterUpload, passwordChange, timetable*, …
  components/                         account, admin, analytics, branding, content, layout, planner,
                                      pwa, search, smartstudy, study, ui, ProtectedRoute
  pages/                              top-level (portal selection/login, profile, reset password),
                                      student/, teacher/, admin/
supabase/
  config.toml                         local Supabase CLI configuration
  migrations/                         59 SQL migrations + 00_MIGRATION_PLAN.md
  functions/admin-create-user/        the single Edge Function
  rollback/                           one rollback script (assignment reliability migration)
  tests/                              three SQL test scripts
  notes_module_rls_verification*.sql  two manual verification scripts
```

## 5. Application bootstrap, routing and authentication **[V]**

- **Entry:** `main.tsx` renders `<BrowserRouter><App/></BrowserRouter>`. The single-file entry uses `HashRouter` so the portable HTML file works without server-side routing.
- **Lazy loading:** page components are loaded with `lazyNamed(...)` inside `Suspense` and an `ErrorBoundary`.
- **Global UI:** `PWAInstallCard` and `PWAUpdateToast` are mounted in `App.tsx`, outside role routing.
- **Supabase client:** `lib/supabaseClient.ts` creates the client only when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set. Otherwise the app shows `ConfigNeededPage`. `detectSessionInUrl` is `false`.
- **Session and profile:** `AuthContext` calls `getSession` / `onAuthStateChange`, then reads the caller's row from `public.users` (`id, email, full_name, phone, role, xp, streak, avatar_url, usn, created_at`). The role always comes from the database, never from browser storage.
- **Per-role login:** `/student/login`, `/teacher/login`, `/admin/login` render one `PortalLoginPage` with `expectedRole`. If the signed-in account's role differs, the page signs the user out and tells them which portal to use.
- **Route guard:** `ProtectedRoute` redirects unauthenticated users to `/login` and wrong-role users to their own dashboard. Its source comment states it is a UX layer only.
- **Password flows:** self-service change (`lib/passwordChange.ts`, shared with the recovery form) and email recovery at `/reset-password`. Supabase Auth is the only password authority.

## 6. Roles and modules

Route paths are taken from `src/App.tsx` **[V]**. A module's existence in the route table does not mean it was exercised end to end in this review **[U]**.

### 6.1 Student (`/student/*`)

| Route | Module |
|---|---|
| `/student` | Dashboard |
| `/student/study` | Study Mode (topic workspace) |
| `/student/smart-study` | Smart Study (server-computed recommendations) |
| `/student/subjects/:subjectId` | Subject detail |
| `/student/notes`, `/student/formulas` | Notes, Formula Hub |
| `/student/tests`, `/student/tests/:testId`, `/student/results` | Tests (server-side scoring), results history |
| `/student/planner` | Planner (read-only) |
| `/student/analytics` | Analytics |
| `/student/timetable`, `/student/attendance`, `/student/ia` | Timetable, attendance, IA marks |
| `/student/announcements` | Announcements feed |
| `/student/profile` | Profile, avatar, password change, PWA install |

README additionally states that a student who is a Class Representative (CR) can manage their own section's notes and compose announcements for the section. **[V as policy-level behaviour: `notes_manager`, `is_current_cr_of_section`, `announcements_insert`, `announcements_delete_cr_own` exist; UI behaviour not exercised]**

### 6.2 Teacher (`/teacher/*`)

`/teacher` (dashboard), `/teacher/assignments/:assignmentId` (subject workspace), `content`, `notes`, `formulas`, `questions`, `tests`, `results`, `students`, `my-students`, `timetable`, `attendance`, `ia`, `cr`, `lab-batches`, `announcements`, `planner`, `analytics`, `profile`.

CR designations and lab batches are managed by a class teacher (README); the assignment RPCs are in `02-DATABASE-AND-MIGRATIONS.md`.

### 6.3 Super admin (`/admin/*`)

`/admin` (dashboard), `analytics`, `planner`, `academic-structure`, `academic/:entityKey`, `teachers`, `teacher-assignments`, `class-teachers`, `cr-designations`, `lab-batches`, `timetable`, `attendance`, `ia`, `user-management`, `students`, `student-assignments`, `content`, `notes`, `formulas`, `questions`, `tests`, `results`, `announcements`, `profile`.

`/admin/user-management` creates real Student/Teacher accounts through the `admin-create-user` Edge Function (see `03-SECURITY-AND-ACCESS-CONTROL.md`), and also offers password-reset email and "Demote to Student".

## 7. Academic hierarchy: conceptual order versus database relationships

The portal's academic structure is described in two ways. They answer different questions and must not be merged.

### 7.1 Conceptual hierarchy (how the portal presents the academic structure) **[O]**

```
academic year → regulation → program → semester → section → subject → unit → topic → content
```

This is the project's conceptual order, used for navigation and for explaining the domain. **It is not a statement that each level is the database parent of the next level.** In particular, `subject` is not a child of `section` in the database (see 7.2 and 7.3).

### 7.2 Actual foreign-key relationships in the database **[V]**

Source: `20260831004231_03_academic_hierarchy.sql` and `20260831004247_04_assignments_enrollments.sql`.

```
academic_years
  ├── regulations        (academic_year_id)
  │     └── programs     (regulation_id)
  │           └── semesters   (program_id)
  │                 ├── sections   (semester_id)  ── also references academic_years (academic_year_id)
  │                 └── subjects   (semester_id)
  │                       └── units    (subject_id)
  │                             └── topics   (unit_id)
  │                                   └── content  (topic_id)
  └── sections           (academic_year_id)   [second parent of sections]
```

| Child table | Foreign key column → parent | `ON DELETE` |
|---|---|---|
| `regulations` | `academic_year_id` → `academic_years` | RESTRICT |
| `programs` | `regulation_id` → `regulations` | RESTRICT |
| `semesters` | `program_id` → `programs` | RESTRICT |
| `sections` | `semester_id` → `semesters` | RESTRICT |
| `sections` | `academic_year_id` → `academic_years` | RESTRICT |
| `subjects` | `semester_id` → `semesters` | RESTRICT |
| `units` | `subject_id` → `subjects` | CASCADE |
| `topics` | `unit_id` → `units` | CASCADE |
| `content` | `topic_id` → `topics` | CASCADE |
| `content` | `uploaded_by` → `users` | SET NULL |
| `student_assignments` | `student_id` → `users` | CASCADE |
| `student_assignments` | `academic_year_id`, `regulation_id`, `program_id`, `semester_id`, `section_id` → the five hierarchy tables | RESTRICT |
| `teacher_assignments` | `teacher_id` → `users` | CASCADE |
| `teacher_assignments` | `section_id` → `sections`; `subject_id` → `subjects` | CASCADE |

### 7.3 How sections and subjects relate **[V]**

- **Sections and subjects both belong to a semester.** `sections.semester_id` and `subjects.semester_id` each reference `semesters`. The `subjects` table has no `section_id` column, and no migration adds one. There is no parent/child foreign key between a section and a subject.
- **Teaching assignments connect them.** `teacher_assignments (teacher_id, section_id, subject_id)` (unique per triple) states that a teacher teaches a subject in a section.
- **The database checks that connection is semester-consistent.** The trigger `teacher_assignments_validate_hierarchy` (function `validate_teacher_assignment_hierarchy`, `20260913011853_teacher_assignment_hierarchy_check.sql`) rejects a teacher assignment whose section and subject belong to different semesters. The migration's own header explains the gap this closes: both IDs can be individually valid yet inconsistent.
- **Students reach subjects through their semester.** `student_enrolled_in_subject()` joins `student_assignments.semester_id` to `subjects.semester_id` for the student's current assignment.
- `student_assignments` stores all five hierarchy IDs plus `is_current`. A partial unique index (`one_current_assignment_per_student`) allows one current row per student. No trigger or constraint tying the five IDs to each other was found in the migrations; see `03-SECURITY-AND-ACCESS-CONTROL.md` (E2) for why this matters to the Edge Function. **[V static]**

## 8. Where business logic lives **[V as object existence; behaviour per object names and report evidence]**

| Concern | Server-side objects | Client |
|---|---|---|
| Test delivery and scoring | `get_test_questions`, `submit_test_attempt`, `validate_test_questions` trigger; `questions` has no student SELECT policy | `TestsListPage`, `TakeTestPage` |
| Progress, XP, streaks, achievements | `mark_content_complete`, `record_daily_activity`, `recalc_topic_progress`, `award_achievement_if_earned`; protected-column trigger | Client calls `mark_content_complete`; no client call to `record_daily_activity` was found |
| Study Mode | `study_outline`, `study_topic_context` | `StudyWorkspace` |
| Smart Study | `smart_study_overview` (SECURITY INVOKER) | `SmartStudyPage`, `AcademicSnapshot` |
| Global search | `global_search` (excludes questions, answers, storage paths per README) | `GlobalSearch` |
| Analytics | `analytics_*` functions (SECURITY INVOKER) | `lib/analytics.ts` |
| Planner | `planner_events` table, `planner_*` helper functions, `validate_planner_event` trigger | `components/planner/*` |
| Notes and chapters | `notes`, `note_chapters`, `notes_*` helpers, `validate_note*` triggers | `NotesManager`, `NotesPage` |
| Announcements and posters | `announcements`, `posters` bucket policies | `AnnouncementManager`, `AnnouncementsFeed` |
| Timetable, attendance, IA | validation/stamp triggers, `attendance_audit_log` | respective pages |
| Assignments and CR/lab batches | `assign_student_to_section`, `reassign_student_to_section`, `assign_class_teacher`, `end_class_teacher`, `assign_cr_designation`, `end_cr_designation`, `assign_lab_batch`, `unassign_lab_batch` | admin and teacher pages |

Scope enumerations **[V]**: announcements `scope_type` ∈ {`all`, `academic_year`, `regulation`, `program`, `semester`, `section`}; planner `target_scope` ∈ the same plus `subject`.

## 9. Build targets and PWA **[V]**

- **Normal build** (`npm run build` → `dist/`): code-split, PWA enabled (`generateSW`, `registerType: "prompt"`), service worker precaches the app shell only. There is **no `runtimeCaching`** entry, so Supabase requests are never cached.
- **Single-file build** (`npx vite build -c vite.config.singlefile.ts`): portable HTML, HashRouter, **no** service worker or manifest by design.
- `vercel.json`: SPA rewrite to `/index.html`; long-lived immutable cache for `/assets/*`; `must-revalidate` for `index.html`, `sw.js`, `registerSW.js`, `manifest.webmanifest`; day-long cache for icons.
- The hosting provider and production URL are **[U]**: the repository is configured for Vercel, but no document in the repository states where production is hosted.

## 10. Present in the schema but not used by the UI **[V]**

No client code reads these tables: `reels`, `reel_bookmarks`, `reel_watch_history`, `experiments`, `experiment_attempts`, `experiment_questions`, `experiment_required_components`, `lab_components`, `lab_component_properties`, `lab_component_terminals`, `student_circuits`, and `achievements` (the `student_achievements` table is referenced by the client). Their fate is an open owner decision (`05-PROJECT-STATUS-AND-KNOWN-ISSUES.md`).

## 11. Documented-but-unverified architecture statements

- Production hosting, domain and Auth site/redirect URLs **[U]**.
- Exact end-to-end behaviour of every module (no application tests; no browser run in this review) **[U]**.
- Whether the single-file build is still used operationally **[U]**.
