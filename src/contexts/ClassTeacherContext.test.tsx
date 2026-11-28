import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { ClassTeacherProvider, useClassTeacher } from "./ClassTeacherContext";

// Provider tests with a hand-rolled Supabase query builder. Every response is
// a promise the test controls, so loading / error / late-response / re-login
// timing can be reproduced deterministically. No network, no real project.
type Result = { data: unknown; error: unknown };
type Deferred = { promise: Promise<Result>; resolve: (r: Result) => void };
const deferred = (): Deferred => {
  let resolve!: (r: Result) => void;
  const promise = new Promise<Result>((r) => (resolve = r));
  return { promise, resolve };
};

const h = vi.hoisted(() => ({
  profile: null as null | { id: string; role: string },
  calls: [] as Array<{ table: string; select: string; eq: Array<[string, unknown]> }>,
  responder: (() => Promise.resolve({ data: [], error: null })) as () => Promise<unknown>,
}));

vi.mock("./AuthContext", () => ({ useAuth: () => ({ profile: h.profile }) }));
vi.mock("../lib/supabaseClient", () => ({
  supabase: {
    from(table: string) {
      const call = { table, select: "", eq: [] as Array<[string, unknown]> };
      h.calls.push(call);
      const builder = {
        select(s: string) { call.select = s; return builder; },
        eq(col: string, val: unknown) { call.eq.push([col, val]); return builder; },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          return h.responder().then(res, rej);
        },
      };
      return builder;
    },
  },
}));

const rows = (...names: string[]) => ({ data: names.map((n, i) => ({ section_id: `sec-${i + 1}`, sections: { name: n } })), error: null });
const teacher = (id: string) => ({ id, role: "teacher" });

function Probe() {
  const v = useClassTeacher();
  return (
    <div>
      <span data-testid="status">{v.status}</span>
      <span data-testid="is">{String(v.isClassTeacher)}</span>
      <span data-testid="sections">{v.sections.map((s) => `${s.id}:${s.name}`).join(",")}</span>
      <span data-testid="error">{v.error ?? ""}</span>
      <button onClick={v.retry}>retry</button>
    </div>
  );
}
const ui = () => (
  <ClassTeacherProvider>
    <Probe />
  </ClassTeacherProvider>
);
const status = () => screen.getByTestId("status").textContent;
function setup(profile: typeof h.profile, responder?: () => Promise<unknown>) {
  h.profile = profile;
  h.calls.length = 0;
  h.responder = responder ?? (() => Promise.resolve(rows("A")));
  return render(ui());
}

describe("ClassTeacherProvider", () => {
  it("looks up only the signed-in teacher's CURRENT assignments", async () => {
    setup(teacher("T1"));
    await waitFor(() => expect(status()).toBe("ready"));
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].table).toBe("class_teacher_assignments");
    expect(h.calls[0].select).toBe("section_id, sections(name)");
    expect(h.calls[0].eq).toEqual([["teacher_id", "T1"], ["is_current", true]]);
  });

  it("is loading first (never granting), then ready with sections for an assigned teacher", async () => {
    const d = deferred();
    setup(teacher("T1"), () => d.promise);
    expect(status()).toBe("loading");
    expect(screen.getByTestId("is").textContent).toBe("false");
    await act(async () => d.resolve(rows("A", "B")));
    await waitFor(() => expect(status()).toBe("ready"));
    expect(screen.getByTestId("is").textContent).toBe("true");
    expect(screen.getByTestId("sections").textContent).toBe("sec-1:A,sec-2:B");
  });

  it("is ready but NOT a class teacher when there are no current assignments", async () => {
    setup(teacher("T1"), () => Promise.resolve({ data: [], error: null }));
    await waitFor(() => expect(status()).toBe("ready"));
    expect(screen.getByTestId("is").textContent).toBe("false");
    expect(screen.getByTestId("sections").textContent).toBe("");
  });

  it("fails closed on a query error, then recovers on retry", async () => {
    let n = 0;
    setup(teacher("T1"), () => Promise.resolve(++n === 1 ? { data: null, error: { message: "boom", code: "XX000" } } : rows("A")));
    await waitFor(() => expect(status()).toBe("error"));
    expect(screen.getByTestId("is").textContent).toBe("false");
    expect(screen.getByTestId("error").textContent).not.toBe("");
    await act(async () => screen.getByText("retry").click());
    await waitFor(() => expect(status()).toBe("ready"));
    expect(screen.getByTestId("is").textContent).toBe("true");
    expect(h.calls).toHaveLength(2);
  });

  it("stays idle and makes no query for students, super admins and signed-out users", async () => {
    for (const p of [{ id: "S1", role: "student" }, { id: "A1", role: "super_admin" }, null]) {
      const { unmount } = setup(p);
      await act(async () => {});
      expect(status()).toBe("idle");
      expect(screen.getByTestId("is").textContent).toBe("false");
      expect(h.calls).toHaveLength(0);
      unmount();
    }
  });

  it("does not refetch when the profile object refreshes but the teacher is the same", async () => {
    const { rerender } = setup(teacher("T1"));
    await waitFor(() => expect(status()).toBe("ready"));
    h.profile = teacher("T1"); // new object, same id (e.g. refreshProfile / token refresh)
    rerender(ui());
    await act(async () => {});
    expect(h.calls).toHaveLength(1);
    expect(status()).toBe("ready");
  });

  it("REGRESSION: after sign-out, the same teacher signing back in is NOT shown the previous session's result", async () => {
    const { rerender } = setup(teacher("T1"));
    await waitFor(() => expect(status()).toBe("ready"));
    expect(screen.getByTestId("is").textContent).toBe("true");

    h.profile = null; // sign out
    rerender(ui());
    await act(async () => {});
    expect(status()).toBe("idle");

    const slow = deferred();
    h.responder = () => slow.promise; // fresh lookup is slow, and the assignment has since been removed
    h.profile = teacher("T1"); // same teacher signs back in, same tab
    rerender(ui());
    // While the new lookup is in flight the stale "assigned" answer must NOT be visible.
    expect(status()).toBe("loading");
    expect(screen.getByTestId("is").textContent).toBe("false");
    expect(screen.getByTestId("sections").textContent).toBe("");

    await act(async () => slow.resolve({ data: [], error: null }));
    await waitFor(() => expect(status()).toBe("ready"));
    expect(screen.getByTestId("is").textContent).toBe("false");
    expect(h.calls).toHaveLength(2);
  });

  it("never exposes one teacher's result to another teacher", async () => {
    const { rerender } = setup(teacher("T1"));
    await waitFor(() => expect(status()).toBe("ready"));
    const slow = deferred();
    h.responder = () => slow.promise;
    h.profile = teacher("T2");
    rerender(ui());
    expect(status()).toBe("loading");
    expect(screen.getByTestId("is").textContent).toBe("false");
    expect(h.calls[1].eq[0]).toEqual(["teacher_id", "T2"]);
    await act(async () => slow.resolve({ data: [], error: null }));
    await waitFor(() => expect(status()).toBe("ready"));
    expect(screen.getByTestId("is").textContent).toBe("false");
  });

  it("discards a late response that belongs to a previous teacher", async () => {
    const first = deferred();
    const second = deferred();
    let n = 0;
    const { rerender } = setup(teacher("T1"), () => (++n === 1 ? first.promise : second.promise));
    h.profile = teacher("T2");
    rerender(ui());
    await act(async () => second.resolve({ data: [], error: null })); // T2: not a class teacher
    await waitFor(() => expect(status()).toBe("ready"));
    await act(async () => first.resolve(rows("A"))); // T1's slow answer arrives late
    await act(async () => {});
    expect(screen.getByTestId("is").textContent).toBe("false"); // must not leak into T2
  });

  it("throws a clear error if used outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/ClassTeacherProvider/);
    spy.mockRestore();
  });
});
