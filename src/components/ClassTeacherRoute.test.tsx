import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

// Direct-URL protection for /teacher/cr and /teacher/lab-batches. The
// context hook is replaced so each status can be forced exactly.
const h = vi.hoisted(() => ({
  ct: { status: "loading", isClassTeacher: false, error: null as string | null, sections: [], retry: () => {} },
}));
vi.mock("../contexts/ClassTeacherContext", () => ({ useClassTeacher: () => h.ct }));

import { ClassTeacherRoute } from "./ClassTeacherRoute";

function Dashboard() {
  const loc = useLocation();
  return <div>TEACHER DASHBOARD state={JSON.stringify(loc.state)}</div>;
}

function renderRoute(path = "/teacher/cr") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/teacher" element={<Dashboard />} />
        {["/teacher/cr", "/teacher/lab-batches"].map((p) => (
          <Route key={p} path={p} element={<ClassTeacherRoute><div>RESTRICTED PAGE</div></ClassTeacherRoute>} />
        ))}
      </Routes>
    </MemoryRouter>
  );
}
const set = (over: Partial<typeof h.ct>) => Object.assign(h.ct, { status: "loading", isClassTeacher: false, error: null, retry: () => {} }, over);

describe("ClassTeacherRoute", () => {
  it.each(["loading", "idle"])("withholds the page while status is %s", (status) => {
    set({ status });
    renderRoute();
    expect(screen.getByText(/checking your class teacher access/i)).toBeTruthy();
    expect(screen.queryByText("RESTRICTED PAGE")).toBeNull();
  });

  it("fails closed on a query error: shows the error with Retry and NEVER the page", () => {
    const retry = vi.fn();
    set({ status: "error", error: "lookup failed", retry });
    renderRoute();
    expect(screen.getByText(/couldn't verify class teacher access/i)).toBeTruthy();
    expect(screen.getByText("lookup failed")).toBeTruthy();
    expect(screen.queryByText("RESTRICTED PAGE")).toBeNull();
    fireEvent.click(screen.getByText(/try again/i));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("does not treat an error that still claims isClassTeacher as access", () => {
    set({ status: "error", isClassTeacher: true, error: "x" });
    renderRoute();
    expect(screen.queryByText("RESTRICTED PAGE")).toBeNull();
  });

  it("redirects an unassigned teacher to /teacher with the access-required flag", () => {
    set({ status: "ready", isClassTeacher: false });
    renderRoute("/teacher/lab-batches");
    expect(screen.queryByText("RESTRICTED PAGE")).toBeNull();
    expect(screen.getByText(/TEACHER DASHBOARD/)).toBeTruthy();
    expect(screen.getByText(/classTeacherRequired":true/)).toBeTruthy();
  });

  it.each(["/teacher/cr", "/teacher/lab-batches"])("renders %s for a confirmed class teacher", (path) => {
    set({ status: "ready", isClassTeacher: true });
    renderRoute(path);
    expect(screen.getByText("RESTRICTED PAGE")).toBeTruthy();
  });
});
