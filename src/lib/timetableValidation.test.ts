import { describe, expect, it } from "vitest";
import {
  checkTimetableClash,
  filterEntriesForStudent,
  getEligibleTeachers,
  isLabSubject,
  type TimetableEntryLike,
  type ValidationCandidate,
} from "./timetableValidation";

const entry = (over: Partial<TimetableEntryLike> = {}): TimetableEntryLike => ({
  id: "e1",
  section_id: "secA",
  day_of_week: 1,
  start_time: "09:00:00",
  end_time: "09:55:00",
  subject_id: "sub1",
  teacher_id: "t1",
  room: "R101",
  lab_batch_id: null,
  block_type: "lecture",
  is_current: true,
  ...over,
});

const candidate = (over: Partial<ValidationCandidate> = {}): ValidationCandidate => ({
  id: null,
  day_of_week: 1,
  start_time: "09:00",
  end_time: "09:55",
  block_type: "lecture",
  section_id: "secA",
  subject_id: "sub2",
  teacher_id: "t2",
  lab_batch_id: null,
  room: "R202",
  ...over,
});

describe("checkTimetableClash", () => {
  it("accepts a non-overlapping slot", () => {
    expect(checkTimetableClash(candidate({ start_time: "10:00", end_time: "10:50", section_id: "secB" }), [entry()]).valid).toBe(true);
  });

  it("rejects an end time that is not after the start time", () => {
    const r = checkTimetableClash(candidate({ start_time: "10:00", end_time: "10:00" }), []);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/after start/i);
  });

  it("rejects an exact duplicate entry", () => {
    const dup = candidate({ subject_id: "sub1", teacher_id: "t1", room: "r101" }); // room compare is case-insensitive
    expect(checkTimetableClash(dup, [entry()]).error).toMatch(/exact details/i);
  });

  it("rejects an overlapping class for the same section", () => {
    const r = checkTimetableClash(candidate({ start_time: "09:30", end_time: "10:20" }), [entry()]);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/section already has a class/i);
  });

  it("rejects a teacher double-booking across sections", () => {
    const r = checkTimetableClash(candidate({ section_id: "secB", teacher_id: "t1" }), [entry()]);
    expect(r.error).toMatch(/teacher is already assigned/i);
  });

  it("rejects a room double-booking across sections", () => {
    const r = checkTimetableClash(candidate({ section_id: "secB", room: " r101 " }), [entry()]);
    expect(r.error).toMatch(/room is already occupied/i);
  });

  it("allows two different lab batches of one section to run simultaneously", () => {
    const batch1 = entry({ block_type: "lab", lab_batch_id: "b1", teacher_id: "t1", room: "Lab1" });
    const batch2 = candidate({ block_type: "lab", lab_batch_id: "b2", teacher_id: "t2", room: "Lab2" });
    expect(checkTimetableClash(batch2, [batch1]).valid).toBe(true);
  });

  it("still blocks the SAME lab batch and a whole-class entry overlapping a batch", () => {
    const batch1 = entry({ block_type: "lab", lab_batch_id: "b1", teacher_id: "t1", room: "Lab1" });
    expect(checkTimetableClash(candidate({ block_type: "lab", lab_batch_id: "b1", teacher_id: "t3", room: "Lab3" }), [batch1]).valid).toBe(false);
    expect(checkTimetableClash(candidate({ block_type: "lecture", teacher_id: "t3", room: "R3" }), [batch1]).valid).toBe(false);
  });

  it("ignores ended entries and the entry being edited, and other days", () => {
    expect(checkTimetableClash(candidate(), [entry({ is_current: false })]).valid).toBe(true);
    expect(checkTimetableClash(candidate({ id: "e1" }), [entry()]).valid).toBe(true);
    expect(checkTimetableClash(candidate({ day_of_week: 2 }), [entry()]).valid).toBe(true);
  });
});

describe("filterEntriesForStudent", () => {
  const rows = [
    { id: 1, block_type: "lecture", lab_batch_id: null },
    { id: 2, block_type: "lab", lab_batch_id: "b1" },
    { id: 3, block_type: "lab", lab_batch_id: "b2" },
  ];
  it("shows lectures to everyone and only the student's own lab batch", () => {
    expect(filterEntriesForStudent(rows, "b1").map((r) => r.id)).toEqual([1, 2]);
  });
  it("hides all labs from a student with no batch", () => {
    expect(filterEntriesForStudent(rows, null).map((r) => r.id)).toEqual([1]);
  });
});

describe("getEligibleTeachers", () => {
  const teachers = [{ id: "t1" }, { id: "t2" }, { id: "t3" }];
  const assignments = [
    { teacher_id: "t1", section_id: "secA", subject_id: "sub1" },
    { teacher_id: "t2", section_id: "secB", subject_id: "sub1" },
  ];
  it("returns only teachers assigned to that subject in that section", () => {
    expect(getEligibleTeachers("sub1", "secA", assignments, teachers)).toEqual([{ id: "t1" }]);
  });
  it("returns nothing without a subject or section", () => {
    expect(getEligibleTeachers("", "secA", assignments, teachers)).toEqual([]);
    expect(getEligibleTeachers("sub1", "", assignments, teachers)).toEqual([]);
  });
});

describe("isLabSubject", () => {
  it("detects lab subjects by name", () => {
    expect(isLabSubject({ id: "1", name: "Analog Electronics Laboratory" })).toBe(true);
    expect(isLabSubject({ id: "2", name: "Digital Electronics Lab" })).toBe(true);
    expect(isLabSubject({ id: "3", name: "Basic Electronics Practical" })).toBe(true);
  });

  it("does not treat an ordinary theory subject as a lab", () => {
    expect(isLabSubject({ id: "4", name: "Signals and Systems", code: "21EC32" })).toBe(false);
    expect(isLabSubject({ id: "5", name: "Signals and Systems" })).toBe(false);
  });

  // Deliberately NOT asserted: lab detection from the subject *code*. The
  // implementation uses a loose pattern (any "L" ending the code or followed
  // by a digit) and the repository documents no real code convention, so a
  // test here would pin accidental behaviour. Add one once the convention is
  // confirmed with the department.
});
