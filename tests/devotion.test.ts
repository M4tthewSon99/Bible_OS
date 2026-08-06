import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dateKeyOf,
  emptyEntry,
  formatDateLabel,
  formatMonthLabel,
  hasContent,
  monthKey,
  monthMatrix,
  shiftMonth,
  todayKey,
} from "../lib/devotion";

afterEach(() => {
  vi.useRealTimers();
});

describe("todayKey", () => {
  it("uses the local calendar date, not the UTC one", () => {
    // 23:30 local on a machine behind UTC: toISOString() would already say
    // tomorrow, which would hand an evening reader the wrong entry.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 5, 23, 30));
    expect(todayKey()).toBe("2026-08-05");
  });

  it("pads single-digit months and days", () => {
    expect(dateKeyOf(new Date(2026, 0, 9))).toBe("2026-01-09");
  });
});

describe("monthKey / shiftMonth", () => {
  it("derives the month from a date key", () => {
    expect(monthKey("2026-08-05")).toBe("2026-08");
  });

  it("rolls forward across a year boundary", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("rolls backward across a year boundary", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
});

describe("monthMatrix", () => {
  it("always returns six rows of seven, so the popover keeps one height", () => {
    ["2026-02", "2026-08", "2028-02", "2026-03"].forEach((month) => {
      const rows = monthMatrix(month);
      expect(rows).toHaveLength(6);
      rows.forEach((row) => expect(row).toHaveLength(7));
    });
  });

  it("starts every row on a Sunday", () => {
    monthMatrix("2026-08").forEach((row) => {
      const [year, index, day] = row[0].key.split("-").map(Number);
      expect(new Date(year, index - 1, day).getDay()).toBe(0);
    });
  });

  it("flags leading and trailing days from adjacent months", () => {
    // August 2026 starts on a Saturday, so six leading cells spill from July.
    const cells = monthMatrix("2026-08").flat();
    expect(cells.slice(0, 6).every((cell) => cell.outside)).toBe(true);
    expect(cells[6]).toMatchObject({ key: "2026-08-01", day: 1, outside: false });
    expect(cells.filter((cell) => !cell.outside)).toHaveLength(31);
  });

  it("handles a leap February", () => {
    const inMonth = monthMatrix("2028-02").flat().filter((cell) => !cell.outside);
    expect(inMonth).toHaveLength(29);
    expect(inMonth[28].key).toBe("2028-02-29");
  });

  it("handles a month that already starts on a Sunday", () => {
    // March 2026 starts on a Sunday — no leading spill at all.
    const cells = monthMatrix("2026-03").flat();
    expect(cells[0]).toMatchObject({ key: "2026-03-01", outside: false });
  });
});

describe("labels", () => {
  it("formats a month", () => {
    expect(formatMonthLabel("2026-08")).toBe("August 2026");
  });

  it("formats a date with its weekday", () => {
    expect(formatDateLabel("2026-08-05")).toBe("Wednesday, August 5");
  });
});

describe("hasContent", () => {
  it("is false for a missing entry", () => {
    expect(hasContent(undefined)).toBe(false);
  });

  it("is false for a fresh entry", () => {
    expect(hasContent(emptyEntry("2026-08-05", null))).toBe(false);
  });

  it("is false when every answer is whitespace", () => {
    const entry = emptyEntry("2026-08-05", null);
    entry.answers = { scripture: "   ", prayer: "\n\t" };
    expect(hasContent(entry)).toBe(false);
  });

  it("is true once anything is written", () => {
    const entry = emptyEntry("2026-08-05", null);
    entry.answers = { scripture: "", prayer: "Thank you." };
    expect(hasContent(entry)).toBe(true);
  });
});
