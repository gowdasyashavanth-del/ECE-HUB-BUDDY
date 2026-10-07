-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration 18: Seed Achievement Catalog
--
-- Populates the 4 approved achievement records using the EXISTING
-- achievements table and EXISTING awarding mechanism (award_achievement_
-- if_earned(), deployed in migration 17). No new table, no key strings
-- invented beyond what that function already checks for.
--
-- Key note: the approval message used "100_xp" as a human-readable
-- label; the already-deployed award_achievement_if_earned() checks the
-- literal key 'hundred_xp'. Seeding with 'hundred_xp' to match the
-- existing mechanism rather than redesigning it.
--
-- Idempotent: achievements.key already has a UNIQUE constraint
-- (migration 06) — ON CONFLICT (key) DO NOTHING means re-running this
-- migration can never create duplicates.
-- ═══════════════════════════════════════════════════════════════════════

insert into public.achievements (key, name, description, xp_reward)
values
  ('first_test_completed',    'First Test',    'Completed your first test.', 0),
  ('first_content_completed', 'First Content', 'Completed your first piece of learning content.', 0),
  ('seven_day_streak',        '7-Day Streak',  'Maintained a 7-day activity streak.', 0),
  ('hundred_xp',              '100 XP',        'Earned 100 XP.', 0)
on conflict (key) do nothing;

-- Note: xp_reward is set to 0 for all four — this column exists in the
-- schema but award_achievement_if_earned() does not currently read or
-- apply it (test/content XP comes only from submit_test_attempt's own
-- score-based calculation). Left as an existing, unused schema field
-- rather than wired up now, since doing so would be a behavior change
-- beyond "populate the catalog."

-- ═══════════════════════════════════════════════════════════════════════
-- End of Migration 18.
-- ═══════════════════════════════════════════════════════════════════════
