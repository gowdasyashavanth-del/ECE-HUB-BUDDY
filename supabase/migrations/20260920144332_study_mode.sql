-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration: Study Mode (two read-only functions)
-- Idempotent: safe to run multiple times.
--
-- Study Mode reuses the existing content / notes / formulas / tests /
-- progress / content_completions tables and their RLS untouched. The ONLY
-- reason for a database function is that units and topics are an
-- open-catalog table (any signed-in user can read every name), so a plain
-- query for a guessed topic UUID would reveal another semester's topic
-- names. These functions return NOTHING unless the caller is a student
-- who is enrolled in that topic's subject, using the existing
-- student_enrolled_in_subject() helper — so "no such topic" and "not your
-- topic" are indistinguishable.
--
-- SECURITY INVOKER + STABLE (read-only). Identity is auth.uid(); no user
-- id is ever an argument. Nothing here touches questions, answers,
-- explanations, storage, or any write path.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.study_outline(p_subject_id uuid)
returns table (
  unit_id uuid, unit_name text, unit_order integer,
  topic_id uuid, topic_name text, topic_order integer,
  progress_pct integer, content_total integer, content_done integer
)
language plpgsql security invoker stable set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null or public.current_role() <> 'student' then return; end if;
  if p_subject_id is null or not public.student_enrolled_in_subject(p_subject_id) then return; end if;

  return query
  select u.id, u.name, u.order_number, t.id, t.name, t.order_number,
         coalesce(p.percent_done, 0)::int,
         (select count(*) from public.content c where c.topic_id = t.id and c.is_published)::int,
         (select count(*) from public.content c
            join public.content_completions cc on cc.content_id = c.id and cc.student_id = auth.uid()
           where c.topic_id = t.id and c.is_published)::int
    from public.units u
    join public.topics t on t.unit_id = u.id
    left join public.progress p on p.topic_id = t.id and p.student_id = auth.uid()
   where u.subject_id = p_subject_id
   order by u.order_number, t.order_number, t.id;
end;
$$;

create or replace function public.study_topic_context(p_topic_id uuid)
returns table (
  subject_id uuid, subject_name text, subject_code text,
  unit_id uuid, unit_name text,
  topic_id uuid, topic_name text,
  progress_pct integer,
  prev_topic_id uuid, prev_topic_name text, prev_unit_id uuid,
  next_topic_id uuid, next_topic_name text, next_unit_id uuid
)
language plpgsql security invoker stable set search_path = public
as $$
#variable_conflict use_column
declare v_subject uuid;
begin
  if auth.uid() is null or public.current_role() <> 'student' then return; end if;

  select u.subject_id into v_subject
    from public.topics t join public.units u on u.id = t.unit_id
   where t.id = p_topic_id;
  if v_subject is null or not public.student_enrolled_in_subject(v_subject) then return; end if;

  -- Previous / next follow the existing Unit → Topic ordering, and only
  -- ever range over topics of THIS (already authorised) subject.
  return query
  with ordered as (
    select t.id as tid, t.name as tname, u.id as uid, u.name as uname,
           lag(t.id)   over w as prev_id, lag(t.name)   over w as prev_name, lag(u.id)   over w as prev_unit,
           lead(t.id)  over w as next_id, lead(t.name)  over w as next_name, lead(u.id)  over w as next_unit
      from public.topics t join public.units u on u.id = t.unit_id
     where u.subject_id = v_subject
    window w as (order by u.order_number, t.order_number, t.id)
  )
  select s.id, s.name, s.code, o.uid, o.uname, o.tid, o.tname,
         coalesce(p.percent_done, 0)::int,
         o.prev_id, o.prev_name, o.prev_unit, o.next_id, o.next_name, o.next_unit
    from ordered o
    join public.subjects s on s.id = v_subject
    left join public.progress p on p.topic_id = o.tid and p.student_id = auth.uid()
   where o.tid = p_topic_id;
end;
$$;

revoke all on function public.study_outline(uuid) from public;
revoke all on function public.study_topic_context(uuid) from public;
revoke execute on function public.study_outline(uuid) from anon;
revoke execute on function public.study_topic_context(uuid) from anon;
grant  execute on function public.study_outline(uuid) to authenticated;
grant  execute on function public.study_topic_context(uuid) to authenticated;
