-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration 16: Revoke anon EXECUTE on assessment RPCs
--
-- Found during Phase 8's own verification step (not assumed correct):
-- `revoke all on function ... from public` in Migration 15 was NOT
-- sufficient — Supabase grants default EXECUTE privileges to `anon`
-- and `authenticated` separately from the PUBLIC pseudo-role on newly
-- created functions, so `anon` (fully unauthenticated) could still
-- call get_test_questions()/submit_test_attempt() despite the revoke.
-- Both functions already check auth.uid() is not null internally, so
-- this wasn't a way to actually submit a fake result — but it's real
-- defense-in-depth that should be closed at the grant level too, not
-- left to rely on the function body alone.
-- ═══════════════════════════════════════════════════════════════════════

revoke execute on function public.get_test_questions(uuid) from anon;
revoke execute on function public.submit_test_attempt(uuid, jsonb) from anon;

-- ═══════════════════════════════════════════════════════════════════════
-- End of Migration 16.
-- ═══════════════════════════════════════════════════════════════════════
