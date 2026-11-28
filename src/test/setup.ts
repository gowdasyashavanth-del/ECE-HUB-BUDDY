import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount anything rendered by a test so tests can't leak DOM into each other.
afterEach(() => {
  cleanup();
});
