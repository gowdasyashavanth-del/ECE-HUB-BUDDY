-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration: Smart Study recommendation engine (Phase 5.1)
-- Idempotent: safe to run multiple times.
--
-- ONE read-only function: public.smart_study_overview(p_limit, p_now)
--
--   • SECURITY INVOKER + STABLE, pinned search_path. Every table it reads
--     is filtered by that table's EXISTING row-level security for the
--     caller, and it re-uses the existing analytics_student_tests().
--   • Identity is auth.uid(). There is no student_id argument. Anyone who
--     is not a student (teacher, admin, anonymous) gets no rows.
--   • Nothing is stored. Recommendations are recomputed from live data on
--     every call, so they can never be stale and need no cleanup.
--   • It never reads questions / correct answers / explanations, and
--     never writes anything.
--   • p_now exists so tests can pin the clock. It only changes when
--     "now" is; the UI never sends it. All time maths is timestamptz
--     arithmetic in hours, so the result does not depend on the session
--     time zone.
--
-- Timing source: public.tests has NO scheduled timestamp (only
-- created_at), so an "upcoming test" is a planner_events row of an
-- assessment type (test, quiz, ia, exam, practical_exam). Nothing is
-- invented.
--
-- ── Scoring (all integers; fully deterministic) ───────────────────────
--  Planner assessment (TEST)   hours until start (ongoing counts as 0):
--      <=24h 100 | <=72h 80 | <=7d 60 | <=14d 35 | <=30d 15
--  Planner work item (DEADLINE) assignment / project / lab record:
--      past due (last 14d) 100 | <=24h 90 | <=72h 70 | <=7d 50 | <=14d 25 | <=30d 10
--      seminar / presentation / viva use the same scale (never "past due")
--      + planner priority set by staff: critical +10, important +5
--  Incomplete content (CONTENT): next unfinished topic per subject, in
--      Unit → Topic order:  20 + 3 × min(incomplete items, 10)
--      +30 if that subject has an assessment within 7 days
--      +15 if that subject has a deadline within 7 days (or past due)
--  Recent unfinished study (CONTINUE): the newest readable completion
--      (last 30 days) whose topic still has unfinished content: 35,
--      +10 if the completion was in the last 3 days
--  Weak recent performance (REVIEW): a subject whose latest-attempt-per-
--      test average over the last 60 days is below 60%:
--      40 + min(30, floor((60 - avg) / 2)); +20 if that subject has an
--      assessment within 7 days. Retakes never count twice.
--  Nice-to-have (EXPLORE): only when NOTHING else qualifies: 5
--  Priority label: score >= 70 high | >= 40 medium | else low
--  Order: score desc, due_at asc (nulls last), subject, topic, rec_id
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.smart_study_overview(p_limit integer default 5, p_now timestamptz default null)
returns table (
  rec_id          text,
  category        text,
  priority        text,
  priority_score  integer,
  title           text,
  reason          text,
  reason_code     text,
  details         jsonb,
  subject_id      uuid,
  subject_name    text,
  unit_id         uuid,
  topic_id        uuid,
  topic_name      text,
  planner_event_id uuid,
  test_id         uuid,
  content_id      uuid,
  note_id         uuid,
  formula_id      uuid,
  due_at          timestamptz,
  action_type     text,
  action_target   uuid
)
language plpgsql
security invoker
stable
set search_path = public
as $$
#variable_conflict use_column
declare
  v_now timestamptz := coalesce(p_now, now());
  v_lim integer := least(greatest(coalesce(p_limit, 5), 1), 10);
  v_sem uuid;
begin
  if auth.uid() is null or public.current_role() <> 'student' then
    return;
  end if;

  select sa.semester_id into v_sem
    from public.student_assignments sa
   where sa.student_id = auth.uid() and sa.is_current;
  if v_sem is null then
    return;
  end if;

  return query
  with
  -- The student's own subjects (same rule as student_enrolled_in_subject).
  subs as (
    select s.id, s.name from public.subjects s where s.semester_id = v_sem
  ),
  topic_ord as (
    select t.id as topic_id, t.name as topic_name, u.id as unit_id, u.subject_id,
           u.order_number as uo, t.order_number as tord
      from public.units u join public.topics t on t.unit_id = u.id
     where u.subject_id in (select id from subs)
  ),
  topic_content as (
    select c.topic_id, count(*)::int as total, count(cc.id)::int as done,
           (array_agg(c.id order by c.created_at, c.id) filter (where cc.id is null))[1] as first_incomplete
      from public.content c
      left join public.content_completions cc on cc.content_id = c.id and cc.student_id = auth.uid()
     where c.is_published and c.topic_id in (select topic_id from topic_ord)
     group by c.topic_id
  ),
  topic_formulas as (
    select f.topic_id, count(*)::int as n, (array_agg(f.id order by f.name, f.id))[1] as first_id
      from public.formulas f where f.topic_id in (select topic_id from topic_ord) group by f.topic_id
  ),
  subject_formulas as (
    select f.subject_id, count(*)::int as n from public.formulas f
     where f.subject_id in (select id from subs) group by f.subject_id
  ),
  topic_notes as (
    select n.topic_id, count(*)::int as n, (array_agg(n.id order by n.created_at, n.id))[1] as first_id
      from public.notes n where n.topic_id in (select topic_id from topic_ord) group by n.topic_id
  ),

  -- ── Planner events the student can already see (existing RLS) ──
  ev0 as (
    select e.id, e.title, e.event_type, e.priority as ev_priority, e.subject_id, e.unit_id, e.topic_id, e.test_id,
           e.anchor_at, e.end_at,
           (e.event_type in ('test','ia','exam','quiz','practical_exam')) as is_assessment,
           (e.event_type in ('assignment','project_submission','lab_record_submission')) as is_due_type,
           extract(epoch from (e.anchor_at - v_now)) / 3600.0 as hours
      from public.planner_events e
     where e.event_type in ('test','ia','exam','quiz','practical_exam','assignment','project_submission','lab_record_submission','seminar','presentation','viva')
       and (e.subject_id is null or e.subject_id in (select id from subs))
  ),
  ev as (
    select ev0.*
      from ev0
     where ev0.anchor_at <= v_now + interval '30 days'
       and (
             (ev0.is_due_type and ev0.anchor_at >= v_now - interval '14 days')   -- includes past due
          or (not ev0.is_due_type and coalesce(ev0.end_at, ev0.anchor_at) >= v_now) -- not finished yet
       )
  ),
  ev_scored as (
    select ev.*,
      case when ev.is_assessment then
             case when ev.hours <= 24 then 100 when ev.hours <= 72 then 80 when ev.hours <= 168 then 60 when ev.hours <= 336 then 35 else 15 end
           else
             case when ev.hours < 0 then 100 when ev.hours <= 24 then 90 when ev.hours <= 72 then 70 when ev.hours <= 168 then 50 when ev.hours <= 336 then 25 else 10 end
      end
      + case ev.ev_priority when 'critical' then 10 when 'important' then 5 else 0 end as score,
      case ev.event_type when 'ia' then 'IA' else initcap(replace(ev.event_type, '_', ' ')) end as type_label
      from ev
  ),
  soon_assess as (   -- per subject: has an assessment within 7 days
    select distinct e.subject_id from ev e where e.is_assessment and e.subject_id is not null and e.hours <= 168
  ),
  soon_due as (      -- per subject: has a deadline within 7 days (or past due)
    select distinct e.subject_id from ev e where not e.is_assessment and e.subject_id is not null and e.hours <= 168
  ),

  ev_cand as (
    select
      case when e.is_assessment then 'TEST' else 'DEADLINE' end as category,
      e.score::int as score,
      case when e.is_assessment then 'Prepare for ' || e.title
           when e.hours < 0 then 'Overdue: ' || e.title
           else e.title end as title,
      case
        when e.is_assessment and e.hours <= 0 then
          format('%s%s is happening now.', e.type_label, coalesce(' (' || s.name || ')', ''))
        when e.is_assessment then
          format('%s%s starts in %s.', e.type_label, coalesce(' (' || s.name || ')', ''),
                 case when e.hours < 1 then 'less than an hour' when e.hours < 48 then 'about ' || ceil(e.hours)::int || ' hours' else floor(e.hours / 24)::int || ' days' end)
        when e.hours < 0 then
          format('%s%s is past due.', e.type_label, coalesce(' (' || s.name || ')', ''))
        else
          format('%s%s is due in %s.', e.type_label, coalesce(' (' || s.name || ')', ''),
                 case when e.hours < 1 then 'less than an hour' when e.hours < 48 then 'about ' || ceil(e.hours)::int || ' hours' else floor(e.hours / 24)::int || ' days' end)
      end || case e.ev_priority when 'critical' then ' Marked critical.' when 'important' then ' Marked important.' else '' end as reason,
      case when e.is_assessment then (case when e.hours <= 0 then 'test_now' when e.hours <= 72 then 'test_soon' else 'test_upcoming' end)
           else (case when e.hours < 0 then 'deadline_overdue' when e.hours <= 72 then 'deadline_soon' else 'deadline_upcoming' end) end as reason_code,
      jsonb_build_object('event_type', e.event_type, 'hours_until', round(e.hours::numeric, 1), 'planner_priority', e.ev_priority) as details,
      e.subject_id, s.name as subject_name, tp.unit_id as unit_id,
      case when tp.topic_id is not null then e.topic_id end as topic_id, tp.topic_name,
      e.id as planner_event_id,
      lt.id as test_id,
      null::uuid as content_id, null::uuid as note_id, null::uuid as formula_id,
      e.anchor_at as due_at,
      -- only ever point at something the student can actually open
      case when e.is_assessment and lt.id is not null then 'open_test'
           when e.is_assessment and tp.topic_id is not null then 'study_topic'
           else 'open_planner_event' end as action_type,
      case when e.is_assessment and lt.id is not null then lt.id
           when e.is_assessment and tp.topic_id is not null then tp.topic_id
           else e.id end as action_target,
      e.id::text as key
    from ev_scored e
    left join subs s on s.id = e.subject_id
    left join public.tests lt on lt.id = e.test_id                  -- RLS: null unless the student may open it
    left join topic_ord tp on tp.topic_id = e.topic_id
  ),

  -- ── CONTENT: next unfinished topic per subject ──
  content_topic as (
    select distinct on (o.subject_id) o.subject_id, o.topic_id, o.topic_name, o.unit_id, tc.total, tc.done, tc.first_incomplete
      from topic_ord o join topic_content tc on tc.topic_id = o.topic_id
     where tc.total > tc.done
     order by o.subject_id, o.uo, o.tord, o.topic_id
  ),
  content_cand as (
    select 'CONTENT'::text as category,
      (20 + 3 * least(ct.total - ct.done, 10)
          + case when sa.subject_id is not null then 30 else 0 end
          + case when sd.subject_id is not null then 15 else 0 end)::int as score,
      'Finish ' || ct.topic_name as title,
      format('%s content item%s remain%s incomplete in %s%s%s%s',
             ct.total - ct.done, case when ct.total - ct.done = 1 then '' else 's' end, case when ct.total - ct.done = 1 then 's' else '' end, s.name,
             case when sa.subject_id is not null then ' and an assessment is coming up within a week' else '' end,
             case when sd.subject_id is not null then ' and a deadline is within a week' else '' end,
             case when coalesce(tn.n, 0) + coalesce(tf.n, 0) > 0 then format('. %s%s%s available to review.',
                  case when coalesce(tn.n, 0) > 0 then tn.n || ' note' || case when tn.n = 1 then '' else 's' end else '' end,
                  case when coalesce(tn.n, 0) > 0 and coalesce(tf.n, 0) > 0 then ' and ' else '' end,
                  case when coalesce(tf.n, 0) > 0 then tf.n || ' formula' || case when tf.n = 1 then '' else 's' end else '' end) else '.' end
      ) as reason,
      case when sa.subject_id is not null or sd.subject_id is not null then 'content_incomplete_with_deadline' else 'content_incomplete' end as reason_code,
      jsonb_build_object('incomplete', ct.total - ct.done, 'total', ct.total, 'completed', ct.done,
                         'assessment_within_7d', sa.subject_id is not null, 'deadline_within_7d', sd.subject_id is not null,
                         'notes_available', coalesce(tn.n, 0), 'formulas_available', coalesce(tf.n, 0)) as details,
      ct.subject_id, s.name as subject_name, ct.unit_id, ct.topic_id, ct.topic_name,
      null::uuid as planner_event_id, null::uuid as test_id, ct.first_incomplete as content_id, null::uuid as note_id, null::uuid as formula_id,
      null::timestamptz as due_at,
      'study_topic'::text as action_type, ct.topic_id as action_target, ct.topic_id::text as key
    from content_topic ct
    join subs s on s.id = ct.subject_id
    left join soon_assess sa on sa.subject_id = ct.subject_id
    left join soon_due sd on sd.subject_id = ct.subject_id
    left join topic_notes tn on tn.topic_id = ct.topic_id
    left join topic_formulas tf on tf.topic_id = ct.topic_id
  ),

  -- ── CONTINUE: newest READABLE completion (unpublished / unreadable ones are
  --    skipped by RLS) whose topic still has unfinished content ──
  recent as (
    select cc.completed_at, c.topic_id, c.id as content_id
      from public.content_completions cc
      join public.content c on c.id = cc.content_id
     where cc.student_id = auth.uid() and c.is_published
       and c.topic_id in (select topic_id from topic_ord)
       and cc.completed_at >= v_now - interval '30 days' and cc.completed_at <= v_now
     order by cc.completed_at desc, c.id
     limit 20
  ),
  continue_pick as (
    select r.completed_at, o.topic_id, o.topic_name, o.unit_id, o.subject_id, tc.total, tc.done, tc.first_incomplete
      from recent r join topic_ord o on o.topic_id = r.topic_id join topic_content tc on tc.topic_id = r.topic_id
     where tc.total > tc.done
     order by r.completed_at desc, r.content_id
     limit 1
  ),
  continue_cand as (
    select 'CONTINUE'::text as category,
      (35 + case when cp.completed_at >= v_now - interval '3 days' then 10 else 0 end)::int as score,
      'Continue ' || cp.topic_name as title,
      format('You last worked here and %s content item%s still %s unfinished.', cp.total - cp.done, case when cp.total - cp.done = 1 then '' else 's' end, case when cp.total - cp.done = 1 then 'is' else 'are' end) as reason,
      'continue_topic'::text as reason_code,
      jsonb_build_object('incomplete', cp.total - cp.done, 'total', cp.total, 'last_activity_at', cp.completed_at) as details,
      cp.subject_id, s.name as subject_name, cp.unit_id, cp.topic_id, cp.topic_name,
      null::uuid as planner_event_id, null::uuid as test_id, cp.first_incomplete as content_id, null::uuid as note_id, null::uuid as formula_id,
      null::timestamptz as due_at,
      'study_topic'::text as action_type, cp.topic_id as action_target, cp.topic_id::text as key
    from continue_pick cp join subs s on s.id = cp.subject_id
  ),

  -- ── REVIEW: weak recent performance, from the existing analytics function ──
  res as (
    select a.test_id, a.test_title, a.subject_id, a.latest_pct, a.latest_at
      from public.analytics_student_tests(200) a
     where a.latest_pct is not null and a.subject_id in (select id from subs)
       and a.latest_at >= v_now - interval '60 days' and a.latest_at <= v_now
  ),
  weak_subject as (
    select r.subject_id, round(avg(r.latest_pct), 1) as avg_pct, count(*)::int as n
      from res r group by r.subject_id having avg(r.latest_pct) < 60
  ),
  weak_pick as (
    select distinct on (w.subject_id) w.subject_id, w.avg_pct, w.n, r.test_id as weak_test_id, r.test_title, r.latest_pct, tt.topic_id as test_topic
      from weak_subject w
      join res r on r.subject_id = w.subject_id
      join public.tests tt on tt.id = r.test_id                      -- RLS: still openable by the student
     order by w.subject_id, r.latest_pct asc, r.latest_at desc, r.test_id
  ),
  review_cand as (
    select 'REVIEW'::text as category,
      (40 + least(30, floor((60 - wp.avg_pct) / 2)::int) + case when sa.subject_id is not null then 20 else 0 end)::int as score,
      'Review ' || coalesce(o.topic_name, s.name) as title,
      format('Your recent results in %s average %s%% (lowest: %s at %s%%).%s',
             s.name, wp.avg_pct, wp.test_title, round(wp.latest_pct, 0)::int,
             case when coalesce(tf.n, sf.n, 0) > 0 then format(' %s formula%s available.', coalesce(tf.n, sf.n), case when coalesce(tf.n, sf.n) = 1 then ' is' else 's are' end) else '' end) as reason,
      'weak_performance'::text as reason_code,
      jsonb_build_object('average_latest_pct', wp.avg_pct, 'tests_counted', wp.n, 'lowest_pct', round(wp.latest_pct, 1),
                         'assessment_within_7d', sa.subject_id is not null, 'formulas_available', coalesce(tf.n, sf.n, 0)) as details,
      wp.subject_id, s.name as subject_name, o.unit_id, o.topic_id, o.topic_name,
      null::uuid as planner_event_id, wp.weak_test_id as test_id, null::uuid as content_id, null::uuid as note_id, null::uuid as formula_id,
      null::timestamptz as due_at,
      case when o.topic_id is not null then 'study_topic' else 'open_test' end as action_type,
      case when o.topic_id is not null then o.topic_id else wp.weak_test_id end as action_target,
      wp.subject_id::text as key
    from weak_pick wp
    join subs s on s.id = wp.subject_id
    left join topic_ord o on o.topic_id = wp.test_topic
    left join soon_assess sa on sa.subject_id = wp.subject_id
    left join topic_formulas tf on tf.topic_id = wp.test_topic
    left join subject_formulas sf on sf.subject_id = wp.subject_id
  ),

  main_cand as (
    select * from ev_cand
    union all select * from content_cand
    union all select * from continue_cand
    union all select * from review_cand
  ),

  -- ── EXPLORE: only when nothing else qualified ──
  explore_pick as (
    select o.subject_id, o.topic_id, o.topic_name, o.unit_id, tf.n as nf, tf.first_id as formula_id, tn.n as nn, tn.first_id as note_id
      from topic_ord o
      left join topic_formulas tf on tf.topic_id = o.topic_id
      left join topic_notes tn on tn.topic_id = o.topic_id
     where tf.n is not null or tn.n is not null
     order by (tf.n is null), o.uo, o.tord, o.topic_id
     limit 1
  ),
  explore_cand as (
    select 'EXPLORE'::text as category, 5 as score,
      case when ep.nf is not null then 'Review formulas for ' else 'Review notes for ' end || ep.topic_name as title,
      case when ep.nf is not null then format('%s formula%s available for this topic.', ep.nf, case when ep.nf = 1 then ' is' else 's are' end)
           else format('%s note%s available for this topic.', ep.nn, case when ep.nn = 1 then ' is' else 's are' end) end as reason,
      case when ep.nf is not null then 'explore_formulas' else 'explore_notes' end as reason_code,
      jsonb_build_object('formulas_available', coalesce(ep.nf, 0), 'notes_available', coalesce(ep.nn, 0)) as details,
      ep.subject_id, s.name as subject_name, ep.unit_id, ep.topic_id, ep.topic_name,
      null::uuid as planner_event_id, null::uuid as test_id, null::uuid as content_id,
      case when ep.nf is null then ep.note_id end as note_id, case when ep.nf is not null then ep.formula_id end as formula_id,
      null::timestamptz as due_at,
      case when ep.nf is not null then 'open_formula' else 'open_note' end as action_type,
      case when ep.nf is not null then ep.formula_id else ep.note_id end as action_target,
      ep.topic_id::text as key
    from explore_pick ep join subs s on s.id = ep.subject_id
    where not exists (select 1 from main_cand)
  ),
  all_cand as (
    select * from main_cand union all select * from explore_cand
  ),
  -- one recommendation per topic (highest score wins; CONTINUE beats CONTENT on a tie)
  deduped as (
    select ac.*,
           row_number() over (
             partition by coalesce(ac.topic_id::text, ac.category || ':' || ac.key)
             order by (ac.category in ('CONTENT','CONTINUE','REVIEW','EXPLORE')) desc, ac.score desc,
                      case ac.category when 'CONTINUE' then 0 when 'REVIEW' then 1 when 'CONTENT' then 2 else 3 end, ac.key
           ) as rn
      from all_cand ac
  )
  select d.category || ':' || d.key as rec_id,
         d.category,
         case when d.score >= 70 then 'high' when d.score >= 40 then 'medium' else 'low' end as priority,
         d.score as priority_score,
         d.title, d.reason, d.reason_code, d.details,
         d.subject_id, d.subject_name, d.unit_id, d.topic_id, d.topic_name,
         d.planner_event_id, d.test_id, d.content_id, d.note_id, d.formula_id,
         d.due_at, d.action_type, d.action_target
    from deduped d
   where d.rn = 1 or d.category in ('TEST','DEADLINE')
   order by d.score desc, d.due_at asc nulls last, d.subject_name asc nulls last, d.topic_name asc nulls last, (d.category || ':' || d.key) asc
   limit v_lim;
end;
$$;

revoke all on function public.smart_study_overview(integer, timestamptz) from public;
revoke execute on function public.smart_study_overview(integer, timestamptz) from anon;
grant  execute on function public.smart_study_overview(integer, timestamptz) to authenticated;
