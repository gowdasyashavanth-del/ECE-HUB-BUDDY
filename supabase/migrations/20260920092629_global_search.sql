-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration: Global Search
-- Idempotent: safe to run multiple times.
--
-- ONE read-only function. It is SECURITY INVOKER, so every SELECT inside
-- it runs as the calling user and is filtered by the EXISTING row-level
-- security on content / notes / formulas / tests / planner_events /
-- announcements. Nothing here re-implements authorization — if a user
-- can't SELECT a row through the normal app, this function can't return
-- it either. No table, no view, no search index, no caller-supplied
-- identity: auth.uid() is the only identity in play.
--
-- Deliberately NOT searched or returned:
--   • questions / correct_answer / explanation / tests.question_ids
--     (tests are matched on title + subject/topic names only)
--   • content.file_url / external_url, notes.file_path (storage paths)
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.global_search(p_query text, p_limit integer default 6)
returns table (
  result_type   text,
  id            uuid,
  title         text,
  preview       text,
  subject_id    uuid,
  subject_name  text,
  unit_id       uuid,
  unit_name     text,
  topic_id      uuid,
  topic_name    text,
  section_id    uuid,
  section_name  text,
  meta          jsonb,
  created_at    timestamptz
)
language plpgsql
security invoker
stable
set search_path = public
as $$
declare
  v_q    text;
  v_pats text[];
  v_lim  integer := least(greatest(coalesce(p_limit, 6), 1), 10);
begin
  -- Anonymous callers get nothing (belt and braces: EXECUTE is also
  -- revoked from anon below).
  if auth.uid() is null then
    return;
  end if;

  -- Normalise: trim, cap length, lower-case, split on whitespace, cap
  -- the token count. Anything shorter than 2 characters is not searched.
  v_q := left(btrim(coalesce(p_query, '')), 100);
  if char_length(v_q) < 2 then
    return;
  end if;

  -- Each token becomes a parameterised ILIKE pattern with LIKE
  -- metacharacters (\ % _) escaped, so user input is only ever DATA.
  select array_agg('%' || replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') || '%')
    into v_pats
    from (
      select t from unnest(regexp_split_to_array(lower(v_q), '\s+')) as t
      where t <> '' limit 6
    ) s;
  if v_pats is null then
    return;
  end if;

  return query
  -- ── Content (topic → unit → subject) ──
  (select 'content'::text, c.id, c.title, null::text,
          s.id, s.name, u.id, u.name, tp.id, tp.name, null::uuid, null::text,
          jsonb_build_object('content_type', c.type), c.created_at
     from public.content c
     join public.topics tp on tp.id = c.topic_id
     join public.units u   on u.id = tp.unit_id
     join public.subjects s on s.id = u.subject_id
    where concat_ws(' ', c.title, c.type, s.name, s.code, u.name, tp.name) ilike all (v_pats)
    order by (c.title ilike all (v_pats)) desc, c.created_at desc
    limit v_lim)
  union all
  -- ── Notes (PDF title + subject / unit / chapter context) ──
  (select 'notes'::text, n.id, n.title, null::text,
          s.id, s.name, u.id, u.name, tp.id, tp.name, sec.id, sec.name,
          jsonb_build_object('uploaded_by_name', n.uploaded_by_name), n.created_at
     from public.notes n
     join public.subjects s  on s.id = n.subject_id
     join public.topics tp   on tp.id = n.topic_id
     join public.units u     on u.id = tp.unit_id
     join public.sections sec on sec.id = n.section_id
    where concat_ws(' ', n.title, s.name, s.code, u.name, tp.name) ilike all (v_pats)
    order by (n.title ilike all (v_pats)) desc, n.created_at desc
    limit v_lim)
  union all
  -- ── Formulas (name / description / expression) ──
  (select 'formulas'::text, f.id, f.name,
          left(coalesce(nullif(btrim(f.description), ''), f.expression), 160),
          s.id, s.name, u.id, u.name, tp.id, tp.name, null::uuid, null::text,
          '{}'::jsonb, f.created_at
     from public.formulas f
     join public.subjects s   on s.id = f.subject_id
     left join public.topics tp on tp.id = f.topic_id
     left join public.units u   on u.id = tp.unit_id
    where concat_ws(' ', f.name, f.description, f.expression, s.name, s.code, u.name, tp.name) ilike all (v_pats)
    order by (f.name ilike all (v_pats)) desc, f.created_at desc
    limit v_lim)
  union all
  -- ── Tests (title + context ONLY — no questions, answers or keys) ──
  (select 'tests'::text, t.id, t.title, null::text,
          s.id, s.name, u.id, u.name, tp.id, tp.name, null::uuid, null::text,
          jsonb_build_object('duration_min', t.duration_min,
                             'is_published', t.is_published,
                             'question_count', coalesce(cardinality(t.question_ids), 0)),
          t.created_at
     from public.tests t
     left join public.topics tp on tp.id = t.topic_id
     left join public.units u   on u.id = tp.unit_id
     left join public.subjects s on s.id = coalesce(t.subject_id, u.subject_id)
    where concat_ws(' ', t.title, s.name, s.code, u.name, tp.name) ilike all (v_pats)
    order by (t.title ilike all (v_pats)) desc, t.created_at desc
    limit v_lim)
  union all
  -- ── Planner events ──
  (select 'planner'::text, e.id, e.title, left(e.description, 160),
          s.id, s.name, u.id, u.name, tp.id, tp.name, sec.id, sec.name,
          jsonb_build_object('event_type', e.event_type, 'priority', e.priority,
                             'anchor_at', e.anchor_at, 'all_day', e.all_day),
          e.created_at
     from public.planner_events e
     left join public.subjects s   on s.id = e.subject_id
     left join public.units u      on u.id = e.unit_id
     left join public.topics tp    on tp.id = e.topic_id
     left join public.sections sec on sec.id = e.section_id
    where concat_ws(' ', e.title, e.description, replace(e.event_type, '_', ' '), s.name, s.code, u.name, tp.name) ilike all (v_pats)
    order by (e.title ilike all (v_pats)) desc, e.anchor_at desc
    limit v_lim)
  union all
  -- ── Announcements ──
  (select 'announcements'::text, a.id, a.title, left(a.body, 160),
          null::uuid, null::text, null::uuid, null::text, null::uuid, null::text, null::uuid, null::text,
          jsonb_build_object('scope_type', a.scope_type), a.created_at
     from public.announcements a
    where concat_ws(' ', a.title, a.body) ilike all (v_pats)
    order by (a.title ilike all (v_pats)) desc, a.created_at desc
    limit v_lim);
end;
$$;

revoke all on function public.global_search(text, integer) from public;
revoke execute on function public.global_search(text, integer) from anon;
grant  execute on function public.global_search(text, integer) to authenticated;
