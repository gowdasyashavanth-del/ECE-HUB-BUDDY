import { rangesOverlap, formatTimeRange12 } from "./timetableSlots";

export interface TimetableEntryLike {
  id?: string | null;
  academic_year_id?: string;
  section_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  subject_id: string | null;
  teacher_id: string | null;
  room: string | null;
  lab_batch_id: string | null;
  block_type: string;
  is_current?: boolean;
}

export interface ValidationCandidate {
  id: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  block_type: string;
  section_id: string;
  academic_year_id?: string;
  subject_id: string | null;
  teacher_id: string | null;
  lab_batch_id: string | null;
  room: string;
}

export interface ConflictCheckResult {
  valid: boolean;
  error?: string;
}

export interface SubjectLike {
  id: string;
  name: string;
  code?: string | null;
  semester_id?: string;
}



/**
 * Detects whether a subject is a laboratory subject based on name and code patterns.
 */
export function isLabSubject(subject: SubjectLike): boolean {
  if (!subject) return false;
  const nameMatch = /\b(lab|laboratory|practical|practicals)\b/i.test(subject.name);
  const codeMatch = Boolean(subject.code && /(l\b|\blab\b|l[0-9])/i.test(subject.code));
  return nameMatch || codeMatch;
}

/**
 * Checks for conflicts against existing timetable entries.
 * Matches Postgres validate_timetable_entry trigger:
 * 1. Exact duplicate
 * 2. Section clash: A whole-class (null batch) entry clashes with any entry at that time.
 *    Two entries with distinct lab_batch_id values are allowed to run simultaneously.
 * 3. Teacher clash: A teacher cannot be scheduled in two simultaneous classes.
 * 4. Room clash: A room cannot be occupied by two classes simultaneously.
 */
export function checkTimetableClash(
  candidate: ValidationCandidate,
  existingEntries: TimetableEntryLike[]
): ConflictCheckResult {
  if (candidate.end_time <= candidate.start_time) {
    return { valid: false, error: "End time must be after start time." };
  }

  const candidateBatch = candidate.block_type === "lab" ? candidate.lab_batch_id || null : null;
  const candidateRoom = candidate.room.trim().toLowerCase();

  const others = existingEntries.filter(
    (e) => (e.is_current !== false) && (!candidate.id || e.id !== candidate.id) && e.day_of_week === candidate.day_of_week
  );

  const timeClash = (e: TimetableEntryLike) =>
    rangesOverlap(candidate.start_time, candidate.end_time, e.start_time.slice(0, 5), e.end_time.slice(0, 5));

  // 1. Exact duplicate check
  const exact = others.find(
    (e) =>
      e.section_id === candidate.section_id &&
      e.start_time.slice(0, 5) === candidate.start_time &&
      e.end_time.slice(0, 5) === candidate.end_time &&
      e.subject_id === (candidate.subject_id || null) &&
      e.teacher_id === (candidate.teacher_id || null) &&
      (e.room ?? "").trim().toLowerCase() === candidateRoom &&
      e.lab_batch_id === candidateBatch &&
      e.block_type === candidate.block_type
  );
  if (exact) {
    return { valid: false, error: "A timetable entry with these exact details already exists." };
  }

  // 2. Section clash check:
  // Whole-class entry (null batch) clashes with ANY overlapping entry.
  // Batch entry clashes with whole-class (null batch) or SAME batch entry.
  // Different batches (Batch 1 vs Batch 2) DO NOT clash with each other!
  const sectionClash = others.find(
    (e) =>
      e.section_id === candidate.section_id &&
      timeClash(e) &&
      (e.lab_batch_id === null || candidateBatch === null || e.lab_batch_id === candidateBatch)
  );
  if (sectionClash) {
    return {
      valid: false,
      error: `This section already has a class during this time (${formatTimeRange12(
        sectionClash.start_time,
        sectionClash.end_time
      )}).`,
    };
  }

  // 3. Teacher clash check
  if (candidate.teacher_id) {
    const teacherClash = others.find((e) => e.teacher_id === candidate.teacher_id && timeClash(e));
    if (teacherClash) {
      return {
        valid: false,
        error: `This teacher is already assigned during this time (${formatTimeRange12(
          teacherClash.start_time,
          teacherClash.end_time
        )}).`,
      };
    }
  }

  // 4. Room clash check
  if (candidateRoom) {
    const roomClash = others.find(
      (e) => (e.room ?? "").trim().toLowerCase() === candidateRoom && timeClash(e)
    );
    if (roomClash) {
      return {
        valid: false,
        error: `This room is already occupied during this time (${formatTimeRange12(
          roomClash.start_time,
          roomClash.end_time
        )}).`,
      };
    }
  }

  return { valid: true };
}

/**
 * Filters timetable entries for student personal timetable view.
 * If entry is a lab and student has an assigned lab batch, only show labs matching student's batch.
 * Non-lab entries are always shown to all students in the section.
 */
export function filterEntriesForStudent<T extends { block_type: string; lab_batch_id: string | null }>(
  entries: T[],
  studentBatchId: string | null
): T[] {
  return entries.filter((e) => e.block_type !== "lab" || (Boolean(studentBatchId) && e.lab_batch_id === studentBatchId));
}

/**
 * Determines eligible teachers for a subject in a section.
 * Strictly reflects the production database constraint:
 * A teacher is eligible only if explicitly assigned to the subject in this section in teacher_assignments.
 */
export function getEligibleTeachers<T extends { id: string }>(
  subjectId: string,
  sectionId: string,
  assignments: { teacher_id: string; section_id: string; subject_id: string }[],
  teachers: T[]
): T[] {
  if (!sectionId || !subjectId) return [];

  const eligibleTeacherIds = new Set<string>();

  assignments
    .filter((a) => a.section_id === sectionId && a.subject_id === subjectId)
    .forEach((a) => eligibleTeacherIds.add(a.teacher_id));

  return teachers.filter((t) => eligibleTeacherIds.has(t.id));
}

