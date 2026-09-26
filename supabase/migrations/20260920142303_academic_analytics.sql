-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration: Academic Analytics (read-only functions)
-- Idempotent: safe to run multiple times.
--
-- Every function is SECURITY INVOKER + STABLE (read-only, no writes) with
-- a pinned search_path. They run as the caller, so the EXISTING RLS on
-- progress / results / content_completions / users / student_assignments
-- / teacher_assignments etc. always applies underneath. On top of RLS,
-- the teacher scope is narrowed FURTHER to the exact (subject, section)
-- pairs in teacher_assignments — RLS on results/progress alone is
-- subject-wide for teachers, which is broader than this feature allows.
--
-- Identity is auth.uid() only. No function takes a student_id or
-- teacher_id; the optional section/subject arguments are FILTERS that can
-- only narrow an already-authorised scope, never widen it.
--
-- Definitions (also shown in the UI):
--   attempt        = one row in public.results (one scored submission)
--   latest attempt = the most recent attempt per (student, test)
--   first attempt  = the earliest attempt per (student, test)
--   progress %     = the app's existing formula: rounded average of the
--                    student's progress.percent_done over ALL topics of a
--                    subject (topics without a row count as 0)
-- Nothing here reads questions / correct_answer / explanation.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── STUDENT (own data only; caller must be a student) ────────────────

create or replace function public.analytics_student_summary()
returns table (
  overall_progress_pct integer, topics_total integer,
  content_total integer, content_completed integer, subjects_count integer,
  tests_available integer, tests_available_attempted integer,
  tests_attempted integer, total_attempts integer,
  avg_latest_pct numeric, avg_first_pct numeric, best_pct numeric,
  xp integer, streak integer, achievements_count integer
)
language plpgsql security invoker stable set search_path = public
as $$
declare v_sem uuid;
begin
  if auth.uid() is null or public.current_role() <> 'student' then return; end if;
  select sa.semester_id into v_sem from public.student_assignments sa
   where sa.student_id = auth.uid() and sa.is_current;

  return query
  with subs as (select s.id from public.subjects s where s.semester_id = v_sem),
  tps as (select t.id as topic_id from public.units u join public.topics t on t.unit_id = u.id
           where u.subject_id in (select id from subs)),
  prog as (select coalesce(avg(coalesce(p.percent_done, 0)), 0) as avgp, count(*) as n
             from tps left join public.progress p on p.topic_id = tps.topic_id and p.student_id = auth.uid()),
  cont as (select count(c.id) as total, count(cc.id) as done
             from tps join public.content c on c.topic_id = tps.topic_id and c.is_published
             left join public.content_completions cc on cc.content_id = c.id and cc.student_id = auth.uid()),
  tst as (select t.id from public.tests t
            left join public.topics tp on tp.id = t.topic_id
            left join public.units u on u.id = tp.unit_id
           where t.is_published and coalesce(t.subject_id, u.subject_id) in (select id from subs)),
  res as (select r.test_id, r.created_at, r.score * 100.0 / nullif(r.total, 0) as pct
            from public.results r where r.student_id = auth.uid()),
  per_test as (select test_id, count(*) as attempts, max(pct) as best,
                      (array_agg(pct order by created_at asc))[1] as first_pct,
                      (array_agg(pct order by created_at desc))[1] as latest_pct
                 from res group by test_id)
  select round(prog.avgp)::int, prog.n::int,
         cont.total::int, cont.done::int, (select count(*) from subs)::int,
         (select count(*) from tst)::int,
         (select count(*) from per_test where test_id in (select id from tst))::int,
         (select count(*) from per_test)::int,
         coalesce((select sum(attempts) from per_test), 0)::int,
         (select round(avg(latest_pct), 1) from per_test),
         (select round(avg(first_pct), 1) from per_test),
         (select round(max(best), 1) from per_test),
         (select u.xp from public.users u where u.id = auth.uid()),
         (select u.streak from public.users u where u.id = auth.uid()),
         (select count(*) from public.student_achievements sa2 where sa2.student_id = auth.uid())::int
    from prog, cont;
end;
$$;

create or replace function public.analytics_student_subjects()
returns table (
  subject_id uuid, subject_name text, subject_code text,
  topics_total integer, progress_pct integer,
  content_total integer, content_completed integer,
  tests_available integer, tests_attempted integer, avg_latest_pct numeric
)
language plpgsql security invoker stable set search_path = public
as $$
declare v_sem uuid;
begin
  if auth.uid() is null or public.current_role() <> 'student' then return; end if;
  select sa.semester_id into v_sem from public.student_assignments sa
   where sa.student_id = auth.uid() and sa.is_current;

  return query
  with subs as (select s.id, s.name, s.code, s.order_number from public.subjects s where s.semester_id = v_sem),
  tps as (select u.subject_id, t.id as topic_id from public.units u join public.topics t on t.unit_id = u.id
           where u.subject_id in (select id from subs)),
  prog as (select tps.subject_id, round(avg(coalesce(p.percent_done, 0)))::int as pct, count(*)::int as n
             from tps left join public.progress p on p.topic_id = tps.topic_id and p.student_id = auth.uid()
            group by tps.subject_id),
  cont as (select tps.subject_id, count(c.id)::int as total, count(cc.id)::int as done
             from tps join public.content c on c.topic_id = tps.topic_id and c.is_published
             left join public.content_completions cc on cc.content_id = c.id and cc.student_id = auth.uid()
            group by tps.subject_id),
  tst as (select t.id, coalesce(t.subject_id, u.subject_id) as subject_id from public.tests t
            left join public.topics tp on tp.id = t.topic_id
            left join public.units u on u.id = tp.unit_id
           where t.is_published),
  lat as (select distinct on (r.test_id) r.test_id, r.score * 100.0 / nullif(r.total, 0) as pct
            from public.results r where r.student_id = auth.uid()
           order by r.test_id, r.created_at desc)
  select s.id, s.name, s.code, coalesce(prog.n, 0), coalesce(prog.pct, 0),
         coalesce(cont.total, 0), coalesce(cont.done, 0),
         (select count(*) from tst where tst.subject_id = s.id)::int,
         (select count(*) from tst join lat on lat.test_id = tst.id where tst.subject_id = s.id)::int,
         (select round(avg(lat.pct), 1) from tst join lat on lat.test_id = tst.id where tst.subject_id = s.id)
    from subs s left join prog on prog.subject_id = s.id left join cont on cont.subject_id = s.id
   order by s.order_number;
end;
$$;

create or replace function public.analytics_student_tests(p_limit integer default 50)
returns table (
  test_id uuid, test_title text, subject_id uuid, subject_name text,
  attempts integer, first_pct numeric, latest_pct numeric, best_pct numeric,
  latest_score integer, latest_total integer, first_at timestamptz, latest_at timestamptz
)
language plpgsql security invoker stable set search_path = public
as $$
begin
  if auth.uid() is null or public.current_role() <> 'student' then return; end if;
  return query
  with res as (select r.test_id, r.score, r.total, r.created_at, r.score * 100.0 / nullif(r.total, 0) as pct
                 from public.results r where r.student_id = auth.uid()),
  agg as (select r.test_id, count(*)::int as attempts, max(r.pct) as best,
                 (array_agg(r.pct order by r.created_at asc))[1] as first_pct,
                 (array_agg(r.pct order by r.created_at desc))[1] as latest_pct,
                 (array_agg(r.score order by r.created_at desc))[1] as latest_score,
                 (array_agg(r.total order by r.created_at desc))[1] as latest_total,
                 min(r.created_at) as first_at, max(r.created_at) as latest_at
            from res r group by r.test_id)
  select a.test_id, coalesce(t.title, 'Test no longer available'), su.id, su.name,
         a.attempts, round(a.first_pct, 1), round(a.latest_pct, 1), round(a.best, 1),
         a.latest_score, a.latest_total, a.first_at, a.latest_at
    from agg a
    left join public.tests t on t.id = a.test_id
    left join public.topics tp on tp.id = t.topic_id
    left join public.units u on u.id = tp.unit_id
    left join public.subjects su on su.id = coalesce(t.subject_id, u.subject_id)
   order by a.latest_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

-- ─── TEACHER / ADMIN scope ────────────────────────────────────────────
-- The ONE place that decides which (section, subject) pairs the caller
-- may analyse:
--   teacher     → exactly their teacher_assignments rows
--   super_admin → every section × subject of the section's semester
--   anyone else → nothing
-- p_section / p_subject only NARROW this set.

create or replace function public.analytics_scope_pairs(p_section uuid default null, p_subject uuid default null)
returns table (section_id uuid, subject_id uuid)
language sql security invoker stable set search_path = public
as $$
  select p.section_id, p.subject_id
    from (
      select ta.section_id, ta.subject_id
        from public.teacher_assignments ta
       where auth.uid() is not null and ta.teacher_id = auth.uid() and public.current_role() = 'teacher'
      union
      select sec.id, su.id
        from public.sections sec join public.subjects su on su.semester_id = sec.semester_id
       where auth.uid() is not null and public.is_admin()
    ) p
   where (p_section is null or p.section_id = p_section)
     and (p_subject is null or p.subject_id = p_subject);
$$;

create or replace function public.analytics_roster(p_section uuid default null, p_subject uuid default null)
returns table (
  student_id uuid, full_name text, usn text,
  section_id uuid, section_name text,
  subject_id uuid, subject_name text, subject_code text, semester_number integer,
  content_total integer, content_done integer,
  tests_available integer, tests_attempted integer, total_attempts integer,
  avg_latest_pct numeric, last_activity timestamptz
)
language plpgsql security invoker stable set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  return query
  with fp as (select * from public.analytics_scope_pairs(p_section, p_subject)),
  roster as (select fp.section_id, fp.subject_id, sa.student_id
               from fp join public.student_assignments sa on sa.section_id = fp.section_id and sa.is_current),
  sc as (select u.subject_id, c.id as content_id
           from public.units u join public.topics t on t.unit_id = u.id join public.content c on c.topic_id = t.id
          where c.is_published and u.subject_id in (select subject_id from fp)),
  st as (select t.id as test_id, t.is_published, coalesce(t.subject_id, u.subject_id) as subject_id
           from public.tests t
           left join public.topics tp on tp.id = t.topic_id
           left join public.units u on u.id = tp.unit_id
          where coalesce(t.subject_id, u.subject_id) in (select subject_id from fp)),
  ctot as (select sc.subject_id, count(*)::int as n from sc group by sc.subject_id),
  ttot as (select st.subject_id, (count(*) filter (where st.is_published))::int as n from st group by st.subject_id),
  cdone as (select ro.student_id, ro.subject_id, count(cc.id)::int as done, max(cc.completed_at) as last_c
              from roster ro
              join sc on sc.subject_id = ro.subject_id
              join public.content_completions cc on cc.content_id = sc.content_id and cc.student_id = ro.student_id
             group by ro.student_id, ro.subject_id),
  att as (select r.student_id, r.test_id, count(*) as n, max(r.created_at) as last_r
            from public.results r
           where r.student_id in (select student_id from roster) and r.test_id in (select test_id from st)
           group by r.student_id, r.test_id),
  lat as (select distinct on (r.student_id, r.test_id) r.student_id, r.test_id,
                 r.score * 100.0 / nullif(r.total, 0) as pct
            from public.results r
           where r.student_id in (select student_id from roster) and r.test_id in (select test_id from st)
           order by r.student_id, r.test_id, r.created_at desc)
  select ro.student_id, u.full_name, u.usn, ro.section_id, sec.name,
         ro.subject_id, su.name, su.code, sem.number,
         coalesce(ctot.n, 0), coalesce(cd.done, 0), coalesce(tt.n, 0),
         coalesce(ta_.attempted, 0), coalesce(ta_.attempts, 0), ta_.avg_latest,
         greatest(cd.last_c, ta_.last_r)
    from roster ro
    join public.users u on u.id = ro.student_id
    join public.sections sec on sec.id = ro.section_id
    join public.subjects su on su.id = ro.subject_id
    join public.semesters sem on sem.id = su.semester_id
    left join ctot on ctot.subject_id = ro.subject_id
    left join ttot tt on tt.subject_id = ro.subject_id
    left join cdone cd on cd.student_id = ro.student_id and cd.subject_id = ro.subject_id
    left join lateral (
      select count(distinct a.test_id)::int as attempted, sum(a.n)::int as attempts, max(a.last_r) as last_r,
             (select round(avg(l.pct), 1) from lat l join st s2 on s2.test_id = l.test_id
               where l.student_id = ro.student_id and s2.subject_id = ro.subject_id) as avg_latest
        from att a join st s1 on s1.test_id = a.test_id
       where a.student_id = ro.student_id and s1.subject_id = ro.subject_id
    ) ta_ on true;
end;
$$;

create or replace function public.analytics_student_rows(p_section uuid default null, p_subject uuid default null, p_limit integer default 300)
returns table (
  student_id uuid, full_name text, usn text,
  section_id uuid, section_name text,
  subject_id uuid, subject_name text, subject_code text, semester_number integer,
  content_total integer, content_done integer,
  tests_available integer, tests_attempted integer, total_attempts integer,
  avg_latest_pct numeric, last_activity timestamptz
)
language sql security invoker stable set search_path = public
as $$
  select * from public.analytics_roster(p_section, p_subject) r
   order by r.full_name, r.subject_name
   limit least(greatest(coalesce(p_limit, 300), 1), 1000);
$$;

create or replace function public.analytics_pair_stats(p_section uuid default null, p_subject uuid default null)
returns table (
  section_id uuid, section_name text,
  subject_id uuid, subject_name text, subject_code text, semester_number integer,
  students integer, content_total integer, avg_content_pct numeric,
  tests_available integer, students_with_attempts integer, total_attempts integer, avg_score_pct numeric,
  students_no_attempts integer, students_zero_content integer, students_inactive_14d integer
)
language plpgsql security invoker stable set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  return query
  with fp as (select * from public.analytics_scope_pairs(p_section, p_subject)),
  r as (select * from public.analytics_roster(p_section, p_subject))
  select fp.section_id, sec.name, fp.subject_id, su.name, su.code, sem.number,
         count(r.student_id)::int,
         (select count(*) from public.units u2 join public.topics t2 on t2.unit_id = u2.id
            join public.content c2 on c2.topic_id = t2.id
           where u2.subject_id = fp.subject_id and c2.is_published)::int,
         round(avg(case when r.content_total > 0 then r.content_done * 100.0 / r.content_total end), 1),
         (select count(*) from public.tests t3
            left join public.topics tp3 on tp3.id = t3.topic_id
            left join public.units u3 on u3.id = tp3.unit_id
           where t3.is_published and coalesce(t3.subject_id, u3.subject_id) = fp.subject_id)::int,
         (count(r.student_id) filter (where r.tests_attempted > 0))::int,
         coalesce(sum(r.total_attempts), 0)::int,
         round(avg(r.avg_latest_pct), 1),
         (count(r.student_id) filter (where r.tests_attempted = 0))::int,
         (count(r.student_id) filter (where r.content_total > 0 and r.content_done = 0))::int,
         (count(r.student_id) filter (where r.last_activity is null or r.last_activity < now() - interval '14 days'))::int
    from fp
    join public.sections sec on sec.id = fp.section_id
    join public.subjects su on su.id = fp.subject_id
    join public.semesters sem on sem.id = su.semester_id
    left join r on r.section_id = fp.section_id and r.subject_id = fp.subject_id
   group by fp.section_id, sec.name, fp.subject_id, su.name, su.code, sem.number
   order by sem.number, sec.name, su.name;
end;
$$;

-- ─── SUPER ADMIN overview (aggregates only, no personal data) ─────────
-- Optional hierarchy filters only NARROW the counts. The whole function
-- returns NULL for anyone who is not a super admin.

create or replace function public.analytics_admin_overview(
  p_year uuid default null, p_regulation uuid default null, p_program uuid default null,
  p_semester uuid default null, p_section uuid default null, p_subject uuid default null)
returns jsonb
language plpgsql security invoker stable set search_path = public
as $$
declare
  v_unfiltered boolean := num_nonnulls(p_year, p_regulation, p_program, p_semester, p_section, p_subject) = 0;
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then return null; end if;

  with
  regs as (select r.* from public.regulations r
            where (p_year is null or r.academic_year_id = p_year) and (p_regulation is null or r.id = p_regulation)),
  progs as (select p.* from public.programs p join regs r on r.id = p.regulation_id
             where (p_program is null or p.id = p_program)),
  sems as (select s.* from public.semesters s join progs p on p.id = s.program_id
            where (p_semester is null or s.id = p_semester)
              and (p_section is null or s.id = (select sx.semester_id from public.sections sx where sx.id = p_section))
              and (p_subject is null or s.id = (select bx.semester_id from public.subjects bx where bx.id = p_subject))),
  secs as (select sc.* from public.sections sc join sems s on s.id = sc.semester_id
            where (p_section is null or sc.id = p_section) and (p_year is null or sc.academic_year_id = p_year)),
  subs as (select su.* from public.subjects su join sems s on s.id = su.semester_id
            where (p_subject is null or su.id = p_subject)),
  unts as (select u.* from public.units u where u.subject_id in (select id from subs)),
  tops as (select t.* from public.topics t where t.unit_id in (select id from unts)),
  stu as (select sa.student_id, sa.semester_id, sa.section_id from public.student_assignments sa
           where sa.is_current and sa.semester_id in (select id from sems)
             and (p_section is null or sa.section_id = p_section)
             and (p_year is null or sa.academic_year_id = p_year)),
  cnt as (select c.id, c.is_published, t.id as topic_id, u.subject_id, su.semester_id
            from public.content c join tops t on t.id = c.topic_id join unts u on u.id = t.unit_id join subs su on su.id = u.subject_id),
  pubc as (select * from cnt where is_published),
  nts as (select n.* from public.notes n where n.subject_id in (select id from subs) and n.section_id in (select id from secs)),
  fml as (select f.* from public.formulas f where f.subject_id in (select id from subs)),
  tst as (select t.id, t.is_published, coalesce(t.subject_id, u.subject_id) as subject_id
            from public.tests t left join public.topics tp on tp.id = t.topic_id left join public.units u on u.id = tp.unit_id
           where coalesce(t.subject_id, u.subject_id) in (select id from subs)),
  res as (select r.student_id, r.test_id, r.created_at, r.score * 100.0 / nullif(r.total, 0) as pct
            from public.results r join stu on stu.student_id = r.student_id join tst on tst.id = r.test_id),
  lat as (select distinct on (student_id, test_id) student_id, test_id, pct from res order by student_id, test_id, created_at desc),
  pe as (select e.* from public.planner_events e
          where (p_year is null or e.academic_year_id = p_year)
            and (p_regulation is null or e.regulation_id = p_regulation)
            and (p_program is null or e.program_id = p_program)
            and (p_semester is null or e.semester_id = p_semester)
            and (p_section is null or e.section_id = p_section)
            and (p_subject is null or e.subject_id = p_subject))
  select jsonb_build_object(
    'people', jsonb_build_object(
      'students', (select count(*) from stu),
      'teachers', case when v_unfiltered
                    then (select count(*) from public.users where role = 'teacher')
                    else (select count(distinct ta.teacher_id) from public.teacher_assignments ta
                           where ta.section_id in (select id from secs) and ta.subject_id in (select id from subs)) end),
    'structure', jsonb_build_object(
      'academic_years', case when v_unfiltered then (select count(*) from public.academic_years)
                             else (select count(distinct academic_year_id) from regs) end,
      'regulations', (select count(*) from regs),
      'regulations_active', (select count(*) from regs where is_active),
      'programs', (select count(*) from progs),
      'programs_active', (select count(*) from progs where is_active),
      'semesters', (select count(*) from sems),
      'sections', (select count(*) from secs),
      'subjects', (select count(*) from subs),
      'units', (select count(*) from unts),
      'topics', (select count(*) from tops)),
    'content', jsonb_build_object(
      'total', (select count(*) from cnt),
      'published', (select count(*) from pubc),
      'subjects_with_published', (select count(distinct subject_id) from pubc),
      'topics_with_published', (select count(distinct topic_id) from pubc),
      'completion_records', (select count(*) from public.content_completions cc join stu on stu.student_id = cc.student_id
                              join pubc on pubc.id = cc.content_id and pubc.semester_id = stu.semester_id),
      'completions_possible', (select count(*) from stu join pubc on pubc.semester_id = stu.semester_id)),
    'notes', jsonb_build_object(
      'total', (select count(*) from nts),
      'section_subject_pairs', (select count(*) from secs sc join subs su on su.semester_id = sc.semester_id),
      'pairs_with_notes', (select count(*) from (select distinct section_id, subject_id from nts) x)),
    'formulas', jsonb_build_object(
      'total', (select count(*) from fml),
      'subjects_with_formulas', (select count(distinct subject_id) from fml)),
    'tests', jsonb_build_object(
      'total', (select count(*) from tst),
      'published', (select count(*) from tst where is_published),
      'tests_with_attempts', (select count(distinct test_id) from res),
      'attempts', (select count(*) from res),
      'students_attempted', (select count(distinct student_id) from res),
      'avg_latest_pct', (select round(avg(pct), 1) from lat)),
    'planner', jsonb_build_object(
      'total', (select count(*) from pe),
      'upcoming', (select count(*) from pe where anchor_at >= now()),
      'next_30_days', (select count(*) from pe where anchor_at >= now() and anchor_at < now() + interval '30 days'),
      'by_type', (select coalesce(jsonb_object_agg(event_type, n), '{}'::jsonb) from (select event_type, count(*) as n from pe group by event_type) x)),
    'announcements', jsonb_build_object(
      'total', (select count(*) from public.announcements),
      'last_30_days', (select count(*) from public.announcements where created_at >= now() - interval '30 days'),
      'by_scope', (select coalesce(jsonb_object_agg(scope_type, n), '{}'::jsonb) from (select scope_type, count(*) as n from public.announcements group by scope_type) x))
  ) into v_result;

  return v_result;
end;
$$;

-- ─── Grants: signed-in users only; each function self-gates by role ───
do $$
declare f text;
begin
  foreach f in array array[
    'analytics_student_summary()',
    'analytics_student_subjects()',
    'analytics_student_tests(integer)',
    'analytics_scope_pairs(uuid, uuid)',
    'analytics_roster(uuid, uuid)',
    'analytics_student_rows(uuid, uuid, integer)',
    'analytics_pair_stats(uuid, uuid)',
    'analytics_admin_overview(uuid, uuid, uuid, uuid, uuid, uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('revoke execute on function public.%s from anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
