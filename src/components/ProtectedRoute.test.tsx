import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { UserRole } from "../lib/types";

// Route-guard tests. useAuth and AppShell are replaced so only the guard's
// own decisions are under test (no Supabase, no layout).
const h = vi.hoisted(() => ({
  auth: {
    loading: false,
    session: null as unknown,
    profile: null as null | { role: string },
    profileError: null as string | null,
  },
}));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => h.auth }));
vi.mock("./layout/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="shell">{children}</div>,
}));

import { ProtectedRoute, dashboardPathForRole } from "./ProtectedRoute";

function renderAt(path: string, allowed: UserRole[]) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<div>LOGIN PAGE</div>} />
        <Route path="/student" element={<div>STUDENT HOME</div>} />
        <Route path="/teacher" element={<div>TEACHER HOME</div>} />
        <Route path="/admin" element={<div>ADMIN HOME</div>} />
        <Route
          path="/secret"
          element={
            <ProtectedRoute allowedRoles={allowed}>
              <div>SECRET CONTENT</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

function setAuth(over: Partial<typeof h.auth>) {
  Object.assign(h.auth, { loading: false, session: {}, profile: { role: "teacher" }, profileError: null }, over);
}

describe("dashboardPathForRole", () => {
  it("maps each of the three roles to its dashboard", () => {
    expect(dashboardPathForRole("super_admin")).toBe("/admin");
    expect(dashboardPathForRole("teacher")).toBe("/teacher");
    expect(dashboardPathForRole("student")).toBe("/student");
  });
});

describe("ProtectedRoute", () => {
  it("shows a loading state (and no content) while the session is being checked", () => {
    setAuth({ loading: true, session: null, profile: null });
    renderAt("/secret", ["teacher"]);
    expect(screen.getByText(/checking your session/i)).toBeTruthy();
    expect(screen.queryByText("SECRET CONTENT")).toBeNull();
  });

  it("sends signed-out visitors to /login", () => {
    setAuth({ session: null, profile: null });
    renderAt("/secret", ["teacher"]);
    expect(screen.getByText("LOGIN PAGE")).toBeTruthy();
    expect(screen.queryByText("SECRET CONTENT")).toBeNull();
  });

  it("fails closed with an error when the profile could not be loaded", () => {
    setAuth({ profile: null, profileError: "profile lookup failed" });
    renderAt("/secret", ["teacher"]);
    expect(screen.getByText(/couldn't load your profile/i)).toBeTruthy();
    expect(screen.getByText("profile lookup failed")).toBeTruthy();
    expect(screen.queryByText("SECRET CONTENT")).toBeNull();
  });

  it("waits (without content) while a signed-in user's profile is still loading", () => {
    setAuth({ profile: null });
    renderAt("/secret", ["teacher"]);
    expect(screen.getByText(/loading your profile/i)).toBeTruthy();
    expect(screen.queryByText("SECRET CONTENT")).toBeNull();
  });

  it("redirects a user with the wrong role to their own dashboard", () => {
    setAuth({ profile: { role: "student" } });
    renderAt("/secret", ["teacher"]);
    expect(screen.getByText("STUDENT HOME")).toBeTruthy();
    expect(screen.queryByText("SECRET CONTENT")).toBeNull();
  });

  it("keeps Super Admin out of teacher-only routes (and sends them to /admin)", () => {
    setAuth({ profile: { role: "super_admin" } });
    renderAt("/secret", ["teacher"]);
    expect(screen.getByText("ADMIN HOME")).toBeTruthy();
  });

  it("renders the page inside the app shell for an allowed role", () => {
    setAuth({ profile: { role: "teacher" } });
    renderAt("/secret", ["teacher"]);
    expect(screen.getByTestId("shell")).toBeTruthy();
    expect(screen.getByText("SECRET CONTENT")).toBeTruthy();
  });

  it("lets Super Admin through admin routes", () => {
    setAuth({ profile: { role: "super_admin" } });
    renderAt("/secret", ["super_admin"]);
    expect(screen.getByText("SECRET CONTENT")).toBeTruthy();
  });
});
