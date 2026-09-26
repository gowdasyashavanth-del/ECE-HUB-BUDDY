# ECE Hub Buddy — Engineering Handoff

## 1–3. Overview, architecture, stack
Role-based academic portal (Student / Teacher / Super Admin) for ECE, BGSIT. SPA (React 18, TS, Vite,
Tailwind, React Router) talking directly to Supabase; all authorization is in Postgres (RLS + RPCs).
Two build targets: standard `dist/` and a portable single-file HTML (HashRouter, `vite.config.singlefile.ts`).

## 4. Supabase project
ECE Hub Buddy project ref `pimnesyotoqqsjwnkdew`. Configured only through `VITE_SUPABASE_URL` /
`VITE_SUPABASE_ANON_KEY` (see `.env.example`). No credentials are stored in this package.

## 5–7. Auth, roles, hierarchy
Email/password Supabase Auth; `AuthContext` loads the profile row from `public.users`; `ProtectedRoute`
redirects wrong-role users to their own dashboard (UX only). Roles: `student`, `teacher`, `super_admin`.
Hierarchy: Academic Year → Regulation → Program → Semester → Section → Subject → Unit → Topic → Content.

## 8–10. Database, RLS, storage
46 migrations (13 base + later), 43 public tables, RLS on all, ~106 policies. Helper functions
(`is_admin`, `teacher_has_subject_in_section`, `student_currently_in_section`, `planner_*`, `notes_*`)
are SECURITY DEFINER with fixed search_path. `protect_sensitive_user_columns` blocks role/xp/streak
edits (null-bypass fixed in `20260924003912`). Storage: `avatars` public (own-folder write policies),
`content-files` private with scoped read/write policies for content and notes; signed URLs in the UI.

## 11–13. Modules
Student: Study Mode, Smart Study, Planner, Analytics, Notes, Formula Hub, Tests/Results, Timetable,
Attendance, IA, Announcements, Profile, Global Search. Teacher: subject workspace, Content, Notes,
Formulas, Questions, Tests, Results, Planner, Analytics, Students, Timetable, Attendance, IA, CR, Lab
Batches, Announcements. Admin: Academic Structure, users/assignments, class teachers, CRs, lab
batches, timetable, attendance, IA, planner, analytics, all content modules, announcements.

## 14–22. Feature notes
- **Study Mode** (`/student/study`): topic workspace; topic authorization is server-side.
- **Smart Study** (`/student/smart-study`): `smart_study_overview()` (student-only, `auth.uid()`,
  anon cannot execute) computes recommendations, reasons and priorities; UI only renders. Academic
  Snapshot renders `analytics_student_summary()` values.
- **Planner**: `planner_events`, scope targeting, teacher exact subject+section management, students read-only.
- **Analytics**: role-scoped RPCs (student/teacher/admin).
- **Notes**: teacher/admin manage; CR manages own section; students view; signed URLs.
- **Global Search**: permission-aware RPC; excludes questions/answers/explanations/paths.
- **Assessments**: `get_test_questions` returns no answers; `submit_test_attempt` scores and awards XP server-side.
- **Progress/XP/streaks/achievements**: server-side via `mark_content_complete`, `record_daily_activity`.
- **Profile/avatar**: `avatars/<user id>/…` upload; public avatar URL is intentional.

## 23. Environment setup
`npm ci`, copy `.env.example` to `.env`, set two variables, `npm run dev`.

## 24. Migration state
Local `supabase/migrations/` matches the live project through `20260925160127_admin_user_management_employee_id`
(47 migrations; adds a nullable, unique `employee_id` column to `users`, mirroring the existing `usn`
pattern — no RLS change needed). The live DB was earlier ahead of the recovered ZIP by one file
(`20260924003912`); that gap was closed in a prior session.

## 24a. User Management (real account creation)
Added `admin-create-user` (Supabase Edge Function, `verify_jwt: true`) plus a new admin page
(`UserManagementPage.tsx`, route `/admin/user-management`). Only the function's one
`auth.admin.createUser` call uses the service-role key; the caller's own super_admin check, the
profile update (role/full_name/phone/usn/employee_id) and the `student_assignments` /
`teacher_assignments` insert all run with the calling admin's own JWT, through the pre-existing
`is_admin()`-gated RLS policies (migration 10) — no new RPC or trigger change was needed, because
`protect_sensitive_user_columns()` already only restricts non-admin callers. On a profile or
assignment failure, the function deletes the just-created Auth user so no orphaned login remains.
Duplicate email/USN/employee ID are checked before creation and also caught by the existing unique
constraints. "Reset Password" reuses the existing `resetPasswordForEmail` flow; "Demote to Student"
updates `role` directly (admin-only) and leaves `teacher_assignments` history intact, per the
no-`is_active`-column, no-destructive-deletion rule.

## 24b. Progressive Web App
Real, working install support via `vite-plugin-pwa` (`generateSW`) on the normal Vercel-targeted
build only. Manifest (`ECE Hub Buddy`, standalone, theme `#C7742A`/background `#F3F6F4`, 192/512/
maskable/apple-touch icons in `public/icons/`) and service worker (`src/hooks/usePWAInstall.ts`,
`usePWAUpdate.ts`, `src/components/pwa/`) verified by inspecting the actual generated
`dist/sw.js`/`manifest.webmanifest` — not assumed. No `runtimeCaching` route exists in the generated
worker (confirmed by direct inspection), so Supabase traffic is never touched by the cache. Install
state and update state both come from real browser APIs (`beforeinstallprompt`, `appinstalled`,
`display-mode: standalone`, `navigator.serviceWorker`) — nothing is simulated or hardcoded.
Single-file build has no service worker/manifest by design (documented limitation, not a gap).

While implementing this, found and fixed a real, pre-existing bug: a stale compiled
`vite.config.js`/`.d.ts` next to `vite.config.ts` was silently winning Vite's config file resolution,
so edits to `vite.config.ts` were being built but never actually applied. Deleted both, fixed
`tsconfig.node.json` (added `outDir`) so `tsc -b` can't regenerate them at the project root again, and
added a `.gitignore` guard.

## 25. QA performed (this handoff session)
Source scans (secrets, service-role, BioVerse/Lovable, mock data, storage/auth usage, TODO/console);
live catalog audit of the ECE project (RLS on all tables, SECURITY DEFINER search_path, storage buckets and
policies, questions policies, `get_test_questions`/search do not expose answers, `smart_study_overview` guard
and grants, avatar folder policy); Supabase security advisors; residue check. Earlier phases' 104-case
regression suite was run in prior sessions and was NOT re-run here. No real-browser QA and no logged-in
role testing was performed in this session.

## 26. Build status
Clean `npm ci`, `npm run typecheck`, `npm run build` and single-file build: see final report (all run on this package).

## 27. Known limitations
No repo test runner; SECURITY DEFINER helpers/trigger functions still executable by `anon` (advisor WARN,
no data exposure: they depend on `auth.uid()`); leaked-password protection is off in Auth settings;
main JS chunk >500 kB; legacy Virtual Lab tables from migrations 07/12 exist in the schema but are unused by the UI (applied migrations are never edited retroactively); live DB contains a few manually created announcements (e.g. "Cr test", "Test admin")
that look like manual test data — left untouched pending owner confirmation.

## 28. Deployment checklist
1. Apply migrations in order. 2. Bootstrap first super admin. 3. Create buckets/policies via migrations.
4. Set env vars at build time. 5. Set Auth site/redirect URLs. 6. Enable leaked-password protection.
7. Build and host `dist/`. 8. Smoke-test each portal login.

## 29. Source hygiene
No `.env`, keys, passwords or service-role references in the package; no localStorage auth (only theme
preference; supabase-js manages its own session); no mock data in `src/`.

## 30. BioVerse
BioVerse is a separate Supabase project. It was not queried or modified. Only historical migration
comments mention it as a pattern origin.
