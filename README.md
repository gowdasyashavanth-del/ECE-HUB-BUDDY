# ECE Hub Buddy

Academic management and learning portal for the Electronics & Communication Engineering
department at BGS Institute of Technology (BGSIT). Three role-based portals (Student, Teacher,
Super Admin) on a React + Supabase stack. All data is live Supabase data; there is no mock data
in the application.

## Tech stack
React 18, TypeScript, Vite 5, Tailwind CSS 3, React Router 6 (HashRouter in the single-file build),
Supabase (Auth, Postgres, Row Level Security, Storage) via `@supabase/supabase-js`.

## Setup
```bash
npm ci            # or npm install
cp .env.example .env   # then fill in the two values
npm run dev
```
| Variable | Meaning |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Publishable/anon key (safe for browsers; protected by RLS) |

If they are unset the app shows a "configuration needed" screen. Never add a service-role key to
client code.

## Commands
`npm run typecheck` · `npm run build` (output `dist/`) · `npx vite build -c vite.config.singlefile.ts`
(portable single HTML file, `dist-singlefile/index.singlefile.html`, HashRouter; serve over a local
HTTP server for phone testing). There is no automated test runner in this repo.

## Supabase configuration
Apply every file in `supabase/migrations/` in filename order to a fresh project (numbered `01`–`19`
first, then timestamped files). Create the first super admin through the bootstrap flow
(`19_first_super_admin_bootstrap`), which only works while zero super admins exist. Storage buckets:
`avatars` (public, intentional), `content-files` (private; used for content files and notes). In
Auth settings, consider enabling leaked-password protection. Deploy the `admin-create-user` Edge
Function (`supabase/functions/admin-create-user/`) with `verify_jwt` enabled — it is the only place
the service-role key is used, to create real Auth accounts for the User Management feature.

## Roles
Exactly three: `student`, `teacher`, `super_admin`. The role is read from `public.users`, never from
browser storage. Route guards are UX only; RLS and SECURITY DEFINER RPCs enforce access.

## Academic hierarchy
Academic Year → Regulation → Program → Semester (1–8) → Section → Subject → Unit → Topic → Content.
No Branch entity.

## Features
**Student:** Study Mode (topic workspace), Smart Study (server-computed recommendations plus an
Academic Snapshot), Planner (read-only), Analytics, Notes (view; CRs can manage their own section's
notes), Formula Hub, Tests (server-side scoring), Results, Timetable, Attendance, IA Marks,
Announcements (CRs can compose for their section), Profile/avatar, Global Search.
**Teacher:** My Subjects workspace, Content, Notes, Formulas, Questions, Tests, Results, Planner
(own subject+section scope), Analytics, My Students, Student Performance, Timetable, Attendance, IA
Marks, CR management and Lab Batches (class teacher), Announcements, Profile.
**Super Admin:** User Management (creates real Student/Teacher Supabase Auth accounts, profiles and
academic/teaching assignments in one step, via the `admin-create-user` Edge Function), Academic
Structure CRUD, Students, Teachers, Student and Teacher Assignments,
Class Teachers, CR designations, Lab Batches, Timetable, Attendance, IA Marks, Planner (all scopes),
Analytics, Content/Notes/Formulas/Questions/Tests/Results, Announcements.

Planner events can target all, academic year, regulation, program, semester, section or subject.
Global Search covers content, notes, formulas, tests, planner events and announcements (never
questions, answers, explanations or storage paths).

## Security architecture
- Supabase Auth email/password. Session handled by supabase-js; no custom auth state.
- RLS enabled on every public table; privileged writes go through SECURITY DEFINER RPCs with fixed
  `search_path` that derive identity from `auth.uid()`.
- Protected columns (role, xp, streak) guarded by trigger; scoring is server-side; students never
  read raw questions or correct answers.
- Private files use signed URLs (1 hour); only avatars use public URLs.

## Migrations
See `supabase/migrations/`. Historical comments mentioning BioVerse describe the pattern origin
only; BioVerse is a separate project that this app never touches.

## Deployment notes
Static hosting of `dist/` works (set the two env vars at build time). Configure Auth redirect/site
URLs in Supabase for your domain.

## Security architecture (User Management)
Only `admin-create-user` uses `SUPABASE_SERVICE_ROLE_KEY`, and only to call the Auth Admin API
(`auth.admin.createUser`). Every other operation in that flow — checking the caller is
`super_admin`, writing the profile, inserting the assignment — runs with the calling admin's own
JWT, so it passes through the same RLS/triggers as the rest of the admin panel. If profile or
assignment creation fails after the Auth account was created, the function deletes the Auth account
so no orphaned login is left behind.

## Progressive Web App
ECE Hub Buddy is installable (`vite-plugin-pwa`, `generateSW` strategy) on the **normal build only**
(`npm run build` → `dist/`); the portable single-file build intentionally has no service
worker/manifest (Workbox needs a real output directory to scan, and the single-file build has no
separate origin to register a worker against). The service worker precaches only the app shell
(JS/CSS/HTML/icons/manifest) — there is no `runtimeCaching` entry of any kind, so it never
intercepts, and therefore never caches, any Supabase request (auth, REST, storage); every request to
`*.supabase.co` goes straight to the network exactly as before the service worker existed. Install
uses the real `beforeinstallprompt`/`appinstalled` browser events (`src/hooks/usePWAInstall.ts`) with
an iOS Safari fallback guide, shown once via a global card (`src/components/pwa/PWAInstallCard.tsx`,
mounted in `App.tsx` outside routing so it's identical for every role and logged-out users) and again
on-demand from Profile → Install ECE Hub Buddy. Updates are staged but never force-applied
(`registerType: "prompt"`); `src/hooks/usePWAUpdate.ts` talks to the plain Service Worker API
directly rather than the plugin's `virtual:pwa-register` module, which failed to resolve under this
project's Vite/Rollup combination.

## Known limitations
No automated test suite in the repo; no self-signup (accounts are created by an admin in Supabase);
no server-side email flows beyond Supabase Auth defaults; some SECURITY DEFINER helper/trigger
functions retain default `anon` EXECUTE (harmless without a session, flagged by Supabase advisors);
`supabase/notes_module_rls_verification*.sql` are manual verification scripts.
