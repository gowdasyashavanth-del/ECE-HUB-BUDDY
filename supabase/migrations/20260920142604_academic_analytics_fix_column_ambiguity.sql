-- Fix: OUT-parameter names (section_id, subject_id, student_id, ...) collide with CTE column
-- names inside PL/pgSQL (error 42702). Resolve in favour of columns.

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
#variable_conflict use_column
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
#variable_conflict use_column
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

