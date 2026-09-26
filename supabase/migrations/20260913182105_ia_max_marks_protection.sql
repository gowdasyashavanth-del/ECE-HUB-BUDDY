create or replace function public.validate_ia_assessment_max_marks() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_highest numeric;
begin
  if tg_op = 'UPDATE' and new.max_marks < old.max_marks then
    select max(marks_obtained) into v_highest from public.ia_marks where ia_assessment_id = new.id;
    if v_highest is not null and v_highest > new.max_marks then
      raise exception 'Maximum marks cannot be reduced below an existing student''s mark (highest recorded: %).', v_highest;
    end if;
  end if;
  return new;
end;
$$;

create trigger ia_assessments_validate_max_marks
  before update on public.ia_assessments
  for each row execute function public.validate_ia_assessment_max_marks();
