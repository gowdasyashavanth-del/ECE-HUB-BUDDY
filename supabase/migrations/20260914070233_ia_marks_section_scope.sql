drop policy if exists ia_marks_select on public.ia_marks;
drop policy if exists ia_marks_write on public.ia_marks;

create policy ia_marks_select on public.ia_marks
  for select using (
    public.is_admin()
    or student_id = auth.uid()
    or exists (
      select 1
      from public.ia_assessments ia
      join public.teacher_assignments ta on ta.subject_id = ia.subject_id and ta.teacher_id = auth.uid()
      join public.student_assignments sa on sa.section_id = ta.section_id and sa.is_current
      where ia.id = ia_marks.ia_assessment_id and sa.student_id = ia_marks.student_id
    )
    or exists (
      select 1 from public.student_assignments sa
      join public.class_teacher_assignments cta
        on cta.section_id = sa.section_id and cta.is_current and cta.teacher_id = auth.uid()
      where sa.student_id = ia_marks.student_id and sa.is_current
    )
  );

create policy ia_marks_write on public.ia_marks
  for all using (
    public.is_admin()
    or exists (
      select 1
      from public.ia_assessments ia
      join public.teacher_assignments ta on ta.subject_id = ia.subject_id and ta.teacher_id = auth.uid()
      join public.student_assignments sa on sa.section_id = ta.section_id and sa.is_current
      where ia.id = ia_marks.ia_assessment_id and sa.student_id = ia_marks.student_id
    )
  ) with check (
    public.is_admin()
    or exists (
      select 1
      from public.ia_assessments ia
      join public.teacher_assignments ta on ta.subject_id = ia.subject_id and ta.teacher_id = auth.uid()
      join public.student_assignments sa on sa.section_id = ta.section_id and sa.is_current
      where ia.id = ia_marks.ia_assessment_id and sa.student_id = ia_marks.student_id
    )
  );
