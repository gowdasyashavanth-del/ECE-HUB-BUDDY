import { describe, expect, it } from "vitest";
import { formatTime12, formatTimeRange12 } from "./timeFormat";

describe("formatTime12", () => {
  it("converts 24-hour database times to 12-hour display", () => {
    expect(formatTime12("09:00:00")).toBe("9:00 AM");
    expect(formatTime12("13:45")).toBe("1:45 PM");
    expect(formatTime12("00:05")).toBe("12:05 AM");
    expect(formatTime12("12:00")).toBe("12:00 PM");
  });
  it("returns an empty string for missing input and passes through unparseable text", () => {
    expect(formatTime12(null)).toBe("");
    expect(formatTime12(undefined)).toBe("");
    expect(formatTime12("soon")).toBe("soon");
  });
});

describe("formatTimeRange12", () => {
  it("formats a range and degrades gracefully when one end is missing", () => {
    expect(formatTimeRange12("09:00", "09:55")).toBe("9:00 AM – 9:55 AM");
    expect(formatTimeRange12("09:00", null)).toBe("9:00 AM");
    expect(formatTimeRange12(null, null)).toBe("");
  });
});
