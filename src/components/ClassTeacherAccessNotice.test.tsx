import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { ClassTeacherAccessNotice } from "./ClassTeacherAccessNotice";

function StateProbe() {
  const loc = useLocation();
  return <span data-testid="state">{JSON.stringify(loc.state)}</span>;
}
const renderAt = (state: unknown) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: "/teacher", state }]}>
      <ClassTeacherAccessNotice />
      <StateProbe />
    </MemoryRouter>
  );

describe("ClassTeacherAccessNotice", () => {
  it("shows nothing on a normal visit to the dashboard", () => {
    renderAt(null);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the notice after a redirect and clears the router flag immediately", async () => {
    renderAt({ classTeacherRequired: true });
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/class teacher access required/i));
    // cleared, so a refresh or back/forward will not re-show it
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("null"));
  });

  it("can be dismissed", async () => {
    renderAt({ classTeacherRequired: true });
    await waitFor(() => screen.getByRole("status"));
    await act(async () => fireEvent.click(screen.getByText("Dismiss")));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
