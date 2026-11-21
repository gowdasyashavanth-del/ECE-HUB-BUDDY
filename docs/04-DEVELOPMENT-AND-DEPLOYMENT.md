# ECE Hub Buddy — Development and Deployment Guide

> **Source baseline:** GitHub `main` @ `6d557533a7c26da3fc668ae7e6d1233148129e4c`.
> **Tags:** **[V]** verified in tracked source · **[O]** owner-stated · **[R]** reported by an existing untracked report, not re-verified · **[H]** historical statement in an existing document · **[A]** assumption · **[U]** unresolved / unverified.
>
> This is a *reference*, not an operations runbook. Nothing here authorizes running SQL against production, changing Supabase settings, pushing, or deploying; each of those needs explicit owner approval (§9). No secret values appear; variable **names** only.

## 1. Prerequisites

| Item | Status |
|---|---|
| Node.js + npm | Version not pinned (`package.json` has no `engines`; no `.nvmrc`). **[U]** which version is intended |
| Git | Repository: `gowdasyashavanth-del/ECE-HUB-BUDDY`; default branch `main` **[V]** |
| Supabase CLI | Needed for a local Supabase stack and Edge Functions. Required version is not documented in the repository. **[U]** |
| Docker | Needed by the Supabase CLI for a local stack. **[A]** (standard CLI requirement) |
| A Supabase project (cloud or local) | Provides the URL and publishable/anon key |

## 2. Local frontend development **[V]**

From the README:

```bash
npm ci                 # or npm install
cp .env.example .env   # then fill in the two values
npm run dev
```

| Variable | Meaning |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Publishable/anon key only. **Never** put a service-role key in client code. |

If either is unset the app renders a "configuration needed" screen (`ConfigNeededPage`). `.env` is git-ignored; never commit it.

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run typecheck` | `tsc --noEmit -p tsconfig.app.json` |
| `npm run lint` | ESLint on `ts,tsx` (not mentioned in the README) |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the build locally |
| `npx vite build -c vite.config.singlefile.ts` | Portable single HTML (`dist-singlefile/index.singlefile.html`), HashRouter, no service worker; serve over a local HTTP server for phone testing |

There is **no application test runner and no CI** in the repository. **[V]**

## 3. Supabase backend setup (reference)

### 3.1 Migration inventory and ordering convention **[V]**

- `supabase/migrations/` holds **59 SQL files** plus `00_MIGRATION_PLAN.md` (documentation, not SQL).
- Every SQL filename begins with a 14-digit timestamp (`YYYYMMDDHHMMSS_<label>.sql`). Filename order is timestamp order. The number labels inside names (`01`–`21`, including `15b`) are part of the names and are **not** the ordering key.
- The complete inventory with exact filenames is in `02-DATABASE-AND-MIGRATIONS.md` §2. Header and report numbering conflicts (for example the several uses of "Migration 20" and "Migration 21") are in §3 of that document.

**Fresh-project setup is not documented here as a procedure.** The root `README.md` contains a short instruction to apply every migration in filename order to a fresh project. This guide does not repeat that as an unconditional instruction. Setting up a fresh project from these migrations requires a **separately reviewed and validated procedure**, which has not been written or approved. **[U]** Facts such a procedure would have to account for:

- `00_MIGRATION_PLAN.md` sits in the same folder but is not a migration.
- Legacy filenames were renamed to align with production history (`a386a51`).
- The first `super_admin` is established by a separate, owner-approved action (§3.2), not by a migration.
- Storage buckets are created by migrations; the Edge Function is deployed separately; Auth settings are configured outside migrations.
- `config.toml` enables seeding but there is no `supabase/seed.sql`.

Nothing in this guide authorizes running any migration against any project.

### 3.2 First super admin **[V]**
`bootstrap_first_super_admin(uuid)` (label `19`, amended by label `20`) is the only in-database way to create the first `super_admin`. Its header describes the intended call as a separate, explicit, human-approved action: `select public.bootstrap_first_super_admin('<auth user uuid>');`. It refuses if a `super_admin` already exists. **This should only ever be run by the owner, as an approved action.**

### 3.3 Storage buckets **[V]**
Created by migrations: `avatars` (public), `content-files` (private), `posters` (private). The README currently lists only the first two.

### 3.4 Edge Function **[V]**
`supabase/functions/admin-create-user/` is the only function. It needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` as platform-provided environment variables. The README says to deploy it with `verify_jwt` enabled; `config.toml` has no per-function block for it. The deployment command and the production JWT-verification setting were not verified. **[U]**

### 3.5 Auth settings **[U]**
The README advises considering leaked-password protection and configuring Auth Site/Redirect URLs for the production domain. Current production values are not recorded in the repository.

## 4. Local Supabase stack (`supabase/config.toml`) **[V]**

| Setting | Value |
|---|---|
| `project_id` | `ECE-HUB-BUDDY-PRODUCTION` (a local CLI label; the name can be mistaken for the production project) |
| Ports | API 54321, DB 54322, shadow DB 54320, Studio 54323, local SMTP 54324 |
| Postgres major version | 17 |
| Auth (local only) | `site_url = http://127.0.0.1:3000`; `enable_signup = true`; `minimum_password_length = 6`; `jwt_expiry = 3600`; refresh rotation on; anonymous sign-ins off; MFA off |
| Storage | `file_size_limit = 50MiB`; S3 protocol enabled |
| Seed | `[db.seed] enabled = true`, but there is no `supabase/seed.sql` |

These are **local** settings; they do not describe production.

## 5. Build and deployment architecture

- **Frontend build:** a static `dist/` produced by Vite; the PWA service worker precaches the app shell only; Supabase network calls are never cached (no `runtimeCaching`). **[V]**
- **Hosting:** `vercel.json` rewrites every path to `/index.html` and sets cache headers (immutable one-year cache for `/assets/*`; `max-age=0, must-revalidate` for `index.html`, `sw.js`, `registerSW.js`, `manifest.webmanifest`; one-day cache for `/icons/*`). **[V]** The README says static hosting of `dist/` works, with the two env vars set at build time. Which provider actually serves production, and its URL, are **[U]**.
- **Backend:** Supabase cloud project (Auth, Postgres 17, Storage, one Edge Function). Production project details are intentionally not repeated here; the tracked `ECE-HUB-BUDDY-HANDOFF.md` records the project reference. **[V]**
- **Frontend configuration surface:** exactly two build-time variables (above).

## 6. Testing assets **[V]**

| File | Notes |
|---|---|
| `supabase/tests/assignment_concurrency_test.sql` | Migration 21 suite: executable single-transaction regression section (9 groups, ends in `ROLLBACK`) + commented manual two-session scenarios and teardown |
| `supabase/tests/assignment_reliability_test.sql`, `…_editor.sql` | Tests for the earlier reliability migration; the `_editor` variant is the SQL-editor runner. `supabase/snippets/Untitled query 806.sql` (untracked) is byte-identical to the `_editor` file |
| `supabase/notes_module_rls_verification.sql`, `…_fixed.sql` | Manual notes-module RLS checks. The header says to paste the file into the Supabase SQL Editor; which project it is run against is the operator's choice, so it must not be run against production without approval |

How these were run: against an **isolated local database** with non-production fixtures (per the Migration 21 reports). **[R]** They are manual; nothing runs them automatically. Running any SQL against production is out of scope without explicit approval.

## 7. Git workflow evidence **[V]**

- 41 commits on `main`. Migrations 20 and 21 were committed directly on `main` (`5b24d09`, `6d55753`); no pull request is associated with them.
- Pull requests #1–#12: `main`'s history contains a commit titled "Merge pull request #N from …" for each of #1 through #12, and each PR's head commit (`refs/pull/N/head`) is an ancestor of `main`. That is git-level evidence consistent with all twelve having been merged; the table is in `05-PROJECT-STATUS-AND-KNOWN-ISSUES.md` §1. GitHub's own per-PR status field and the PR discussion threads were **not** read (the GitHub API was rate-limited and the PR pages could not be parsed). **[U]** No `refs/pull/` entries exist beyond #12.
- No branch protection, CI, or commit-message convention is documented in the repository. **[U]**
- Line endings: files are stored with LF; a Windows working copy shows CRLF. There is no `.gitattributes`. **[V]**

## 8. Environment hygiene

- Never commit `.env`; `.gitignore` covers it. **[V]**
- The repository is **public**. Treat every tracked file as publicly readable. **[V]**
- Untracked local material to **preserve, not delete**:
  - **Nine files that are in the handoff ZIP but not on GitHub** (eight reports and one SQL snippet), listed in `05-PROJECT-STATUS-AND-KNOWN-ISSUES.md` §4. Several contain infrastructure identifiers and should be reviewed before any decision to commit them. **[V]/[R]**
  - **`Our-Littele-World-/`** is **previously reported local material**. It was **not** in the ZIP and is not one of the nine; its existence is taken from earlier reports and was not independently observed. **[R]**

## 9. Approval gates (standing project rules) **[O]**

Do not, without explicit owner approval: execute production SQL; change Supabase settings; push to Git; deploy; resume the paused backup/disaster-recovery workstream; expose or request production secrets.

## 10. Unverified operational facts

- Intended Node version; CI expectations.
- Production host, domain, Auth redirect URLs.
- Edge Function deployment command and `verify_jwt` state.
- Whether the portable single-file build is used in practice.
