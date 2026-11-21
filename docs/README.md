# ECE Hub Buddy — Project Documentation Index

> **Source baseline:** GitHub `main` @ `6d557533a7c26da3fc668ae7e6d1233148129e4c` (verified 2026-11-19).

This folder holds the reference documentation for ECE Hub Buddy, an ECE-only portal for BGSIT Autonomous. The root `README.md` remains the concise project introduction and quick-start guide; these documents go deeper.

## 1. Documents

| File | Contents |
|---|---|
| [`01-ARCHITECTURE.md`](01-ARCHITECTURE.md) | Stack, source layout, routing and authentication, roles and modules, the conceptual academic hierarchy versus the database's actual foreign keys, build targets |
| [`02-DATABASE-AND-MIGRATIONS.md`](02-DATABASE-AND-MIGRATIONS.md) | All 59 migrations by exact filename, numbering conflicts, tables, functions, triggers, policies, storage, Migration 20 and 21 facts, rollback status, and the separate evidence classes for production |
| [`03-SECURITY-AND-ACCESS-CONTROL.md`](03-SECURITY-AND-ACCESS-CONTROL.md) | Authentication, role guard, RLS overview, function security in three separate layers, the Edge Function, storage security, open security questions |
| [`04-DEVELOPMENT-AND-DEPLOYMENT.md`](04-DEVELOPMENT-AND-DEPLOYMENT.md) | Local development, configuration, builds, deployment architecture, test assets, git workflow evidence, approval gates |
| [`05-PROJECT-STATUS-AND-KNOWN-ISSUES.md`](05-PROJECT-STATUS-AND-KNOWN-ISSUES.md) | Verified work, Migration 20/21 status, untracked local material, documentation-conflict ledger, unresolved decisions, unverified facts |

Suggested reading order: 05 → 02 → 03 → 01 → 04.

## 2. Evidence tags

Every non-trivial statement carries one of these tags.

| Tag | Meaning |
|---|---|
| **[V]** | Verified in tracked source or git history at the baseline SHA |
| **[O]** | Stated by the project owner |
| **[R]** | Reported by an existing untracked report; not re-verified |
| **[H]** | Historical statement in an existing document |
| **[A]** | Assumption (explicitly labelled) |
| **[U]** | Unresolved / unverified |

**[V static]** means verified by reading migration SQL text only. Counts of tables, policies, functions and triggers come from a static, in-order replay of the migration files. They describe the repository, not the live database, which these documents do not claim to have inspected.

## 3. Project boundaries (preserved by all documents) **[O]**

- Roles: exactly `super_admin`, `teacher`, `student`.
- Academic hierarchy (conceptual order): academic year → regulation → program → semester → section → subject → unit → topic → content. The database relationships differ; see `01-ARCHITECTURE.md` §7.
- No Branch entity, and no Payment, KCET or NEET features.
- Backup and disaster recovery is **paused indefinitely** and is not covered by this documentation set.

## 4. Relationship to other project files

| File | Status |
|---|---|
| `README.md` (repository root) | Remains the concise introduction and quick-start guide **[O]**. Lines in it that conflict with source (ledger items C1, C2, C8 in `05-PROJECT-STATUS-AND-KNOWN-ISSUES.md`) are listed, not changed here |
| `ECE-HUB-BUDDY-HANDOFF.md` | **Preserved as a historical document** **[O]**. Dated 2026-10-05; its counts and migration state are stale (ledger C3–C7), which is why it is treated as historical rather than current |
| `supabase/migrations/00_MIGRATION_PLAN.md` | **Remains in its current location as a historical design note** **[O]** (ledger C10, C11) |
| Nine untracked files in the handoff ZIP (eight reports and one SQL snippet) | Preserved untouched; listed in `05-PROJECT-STATUS-AND-KNOWN-ISSUES.md` §4.1 |
| `Our-Littele-World-/` | Previously reported local material, not in the handoff ZIP; preserved untouched (§4.2 of the same document) |

## 5. Maintenance note

Counts and "as of" statements in these documents are tied to the baseline SHA above. When `main` moves, re-verify them rather than editing them by memory.
