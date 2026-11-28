import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { UserRole } from "../../lib/types";

// Navigation-visibility tests. Only the two Class Teacher links may ever
// depend on assignment status; every other link must be unaffected.
const h = vi.hoisted(() => ({ ct: { status: "ready", isClassTeacher: true } }));
vi.mock("../../contexts/ClassTeacherContext", () => ({ useClassTeacher: () => h.ct }));

import { Sidebar } from "./Sidebar";

const RESTRICTED = ["/teacher/cr", "/teacher/lab-batches"];
const TEACHER_ALL = [
  "/teacher", "/teacher/planner", "/teacher/analytics", "/teacher/my-students", "/teacher/timetable",
  "/teacher/attendance", "/teacher/ia", "/teacher/cr", "/teacher/lab-batches", "/teacher/students",
  "/teacher/content", "/teacher/notes", "/teacher/formulas", "/teacher/questions", "/teacher/tests",
  "/teacher/results", "/teacher/announcements", "/teacher/profile",
];

function hrefs(role: UserRole, ct: { status: string; isClassTeacher: boolean }) {
  Object.assign(h.ct, ct);
  const { container, unmount } = render(
    <MemoryRouter>
      <Sidebar role={role} />
    </MemoryRouter>
  );
  const out = [...container.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") as string);
  unmount();
  return out;
}

describe("Sidebar — Class Teacher links", () => {
  it("shows both links, and every other teacher link, for a confirmed class teacher", () => {
    const links = hrefs("teacher", { status: "ready", isClassTeacher: true });
    expect([...links].sort()).toEqual([...TEACHER_ALL].sort());
  });

  it.each([
    ["loading", { status: "loading", isClassTeacher: false }],
    ["idle", { status: "idle", isClassTeacher: false }],
    ["error", { status: "error", isClassTeacher: false }],
    ["ready but unassigned", { status: "ready", isClassTeacher: false }],
  ])("hides exactly the two restricted links while %s — all other teacher links stay", (_n, ct) => {
    const links = hrefs("teacher", ct);
    for (const r of RESTRICTED) expect(links).not.toContain(r);
    expect([...links].sort()).toEqual(TEACHER_ALL.filter((l) => !RESTRICTED.includes(l)).sort());
  });

  it("fails closed even if a stale flag says class teacher while status is not ready", () => {
    const links = hrefs("teacher", { status: "error", isClassTeacher: true });
    for (const r of RESTRICTED) expect(links).not.toContain(r);
  });

  it("does not change what Super Admin or students see, whatever the class-teacher status", () => {
    const states = [
      { status: "ready", isClassTeacher: true },
      { status: "loading", isClassTeacher: false },
      { status: "error", isClassTeacher: false },
    ];
    const admin = states.map((s) => hrefs("super_admin", s).join("|"));
    const student = states.map((s) => hrefs("student", s).join("|"));
    expect(new Set(admin).size).toBe(1);
    expect(new Set(student).size).toBe(1);
    // Super Admin keeps its own, separate CR management page.
    expect(admin[0].split("|")).toContain("/admin/cr-designations");
    expect(admin[0].split("|")).not.toContain("/teacher/cr");
  });
});
