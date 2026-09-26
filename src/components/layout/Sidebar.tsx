import { NavLink } from "react-router-dom";
import type { UserRole } from "../../lib/types";
import { TraceDivider } from "../branding/TraceDivider";
import { ACADEMIC_NAV_ORDER, ENTITY_CONFIGS } from "../../pages/admin/academic/entityConfigs";

interface NavItem {
  to: string;
  label: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const ACADEMIC_MANAGEMENT_ITEMS: NavItem[] = ACADEMIC_NAV_ORDER.map((key) => ({
  to: `/admin/academic/${key}`,
  label: ENTITY_CONFIGS[key].titlePlural,
}));

const NAV_BY_ROLE: Record<UserRole, NavGroup[]> = {
  student: [
    {
      label: "Learning",
      items: [
        { to: "/student", label: "Home" },
        { to: "/student/study", label: "Study" },
        { to: "/student/smart-study", label: "Smart Study" },
        { to: "/student/planner", label: "Planner" },
        { to: "/student/analytics", label: "Analytics" },
        { to: "/student/notes", label: "Notes" },
        { to: "/student/formulas", label: "Formula Hub" },
        { to: "/student/tests", label: "Tests" },
        { to: "/student/results", label: "My Results" },
        { to: "/student/timetable", label: "Timetable" },
        { to: "/student/attendance", label: "Attendance" },
        { to: "/student/ia", label: "IA Marks" },
        { to: "/student/announcements", label: "Announcements" },
        { to: "/student/profile", label: "Profile" },
      ],
    },
  ],
  teacher: [
    {
      label: "Teaching",
      items: [
        { to: "/teacher", label: "My Subjects" },
        { to: "/teacher/planner", label: "Planner" },
        { to: "/teacher/analytics", label: "Analytics" },
        { to: "/teacher/my-students", label: "My Students" },
        { to: "/teacher/timetable", label: "My Timetable" },
        { to: "/teacher/attendance", label: "Attendance" },
        { to: "/teacher/ia", label: "IA Marks" },
        { to: "/teacher/cr", label: "CR1 / CR2" },
        { to: "/teacher/lab-batches", label: "Lab Batches" },
        { to: "/teacher/students", label: "Student Performance" },
        { to: "/teacher/content", label: "Content" },
        { to: "/teacher/notes", label: "Notes" },
        { to: "/teacher/formulas", label: "Formulas" },
        { to: "/teacher/questions", label: "Questions" },
        { to: "/teacher/tests", label: "Tests" },
        { to: "/teacher/results", label: "Results" },
        { to: "/teacher/announcements", label: "Announcements" },
        { to: "/teacher/profile", label: "Profile" },
      ],
    },
  ],
  super_admin: [
    {
      label: "Platform",
      items: [
        { to: "/admin", label: "Overview" },
        { to: "/admin/academic-structure", label: "Academic Structure" },
        { to: "/admin/user-management", label: "User Management" },
        { to: "/admin/students", label: "Students" },
        { to: "/admin/student-assignments", label: "Student Assignments" },
        { to: "/admin/teachers", label: "Teachers" },
        { to: "/admin/teacher-assignments", label: "Teacher Assignments" },
        { to: "/admin/profile", label: "Profile" },
      ],
    },
    {
      label: "Class & Section Operations",
      items: [
        { to: "/admin/planner", label: "Planner" },
        { to: "/admin/analytics", label: "Analytics" },
        { to: "/admin/class-teachers", label: "Class Teachers" },
        { to: "/admin/cr-designations", label: "CR1 / CR2" },
        { to: "/admin/lab-batches", label: "Lab Batches" },
        { to: "/admin/timetable", label: "Timetable" },
        { to: "/admin/attendance", label: "Attendance" },
        { to: "/admin/ia", label: "IA Marks" },
      ],
    },
    {
      label: "Academic Management",
      items: ACADEMIC_MANAGEMENT_ITEMS,
    },
    {
      label: "Learning Content",
      items: [
        { to: "/admin/content", label: "Content" },
        { to: "/admin/notes", label: "Notes" },
        { to: "/admin/formulas", label: "Formulas" },
        { to: "/admin/questions", label: "Questions" },
        { to: "/admin/tests", label: "Tests" },
        { to: "/admin/results", label: "Results" },
        { to: "/admin/announcements", label: "Announcements" },
      ],
    },
  ],
};

export function Sidebar({ role, onNavigate }: { role: UserRole; onNavigate?: () => void }) {
  const groups = NAV_BY_ROLE[role];

  return (
    <nav className="flex min-h-full flex-col gap-4 px-3 py-4 pb-8" aria-label="Main navigation">
      {groups.map((group) => (
        <div key={group.label}>
          <TraceDivider label={group.label} />
          <ul className="mt-1 flex flex-col gap-0.5">
            {group.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    [
                      "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-body transition-colors",
                      isActive
                        ? "bg-trace-light text-trace-dark font-medium"
                        : "text-inkmuted hover:bg-paper hover:text-ink",
                    ].join(" ")
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={[
                          "h-1.5 w-1.5 rounded-full",
                          isActive ? "bg-trace" : "bg-line",
                        ].join(" ")}
                        aria-hidden="true"
                      />
                      {item.label}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
