import { describe, it, expect } from "vitest";
import {
  timeAgo,
  exerciseNames,
  entriesForDate,
  groupByDate,
  computePRs,
  buildChartData,
  mergeById,
  buildEntries,
} from "./logic";

// Small fixture factory.
const e = (id, exercise, weight, reps, date, ts = id) => ({
  id: String(id),
  exercise,
  weight,
  reps,
  date,
  ts,
});

const sample = [
  e(1, "Bench Press", 185, 5, "2026-07-01", 10),
  e(2, "Bench Press", 205, 3, "2026-07-03", 30),
  e(3, "Squat", 275, 5, "2026-07-01", 20),
  e(4, "Bench Press", 195, 5, "2026-07-03", 40),
];

describe("timeAgo", () => {
  const now = new Date("2026-07-04T12:00:00Z").getTime();
  it("returns 'never' for null", () => expect(timeAgo(null, now)).toBe("never"));
  it("returns 'just now' under a minute", () =>
    expect(timeAgo(new Date(now - 5000).toISOString(), now)).toBe("just now"));
  it("returns minutes", () =>
    expect(timeAgo(new Date(now - 5 * 60000).toISOString(), now)).toBe("5m ago"));
  it("returns hours", () =>
    expect(timeAgo(new Date(now - 3 * 3600000).toISOString(), now)).toBe("3h ago"));
  it("returns days", () =>
    expect(timeAgo(new Date(now - 2 * 86400000).toISOString(), now)).toBe("2d ago"));
});

describe("exerciseNames", () => {
  it("is unique and sorted", () =>
    expect(exerciseNames(sample)).toEqual(["Bench Press", "Squat"]));
  it("handles empty", () => expect(exerciseNames([])).toEqual([]));
});

describe("entriesForDate", () => {
  it("filters by date, newest-logged first", () => {
    const rows = entriesForDate(sample, "2026-07-03");
    expect(rows.map((r) => r.id)).toEqual(["4", "2"]); // ts 40 before ts 30
  });
});

describe("groupByDate", () => {
  it("groups and sorts dates descending", () => {
    const groups = groupByDate(sample);
    expect(groups.map(([d]) => d)).toEqual(["2026-07-03", "2026-07-01"]);
    expect(groups[0][1]).toHaveLength(2);
  });
});

describe("computePRs", () => {
  it("keeps the heaviest per exercise", () => {
    const prs = computePRs(sample);
    expect(prs["Bench Press"].id).toBe("2"); // 205 is the max
    expect(prs["Squat"].id).toBe("3");
  });
});

describe("buildChartData", () => {
  it("returns [] with no selection", () => expect(buildChartData(sample, null)).toEqual([]));
  it("returns one exercise, oldest first, with labels", () => {
    const data = buildChartData(sample, "Bench Press");
    expect(data.map((d) => d.weight)).toEqual([185, 205, 195]); // ts order 10,30,40
    expect(data[0].label).toBe("185×5");
  });
});

describe("mergeById", () => {
  it("unions and lets remote win on id collisions", () => {
    const local = [e(1, "Bench Press", 185, 5, "2026-07-01")];
    const remote = [
      e(1, "Bench Press", 999, 1, "2026-07-01"), // same id, changed
      e(9, "Deadlift", 315, 5, "2026-07-02"),
    ];
    const merged = mergeById(local, remote);
    expect(merged).toHaveLength(2);
    expect(merged.find((m) => m.id === "1").weight).toBe(999); // remote won
    expect(merged.find((m) => m.id === "9")).toBeTruthy();
  });
});

describe("buildEntries", () => {
  it("creates one record per set with unique ids/ts", () => {
    const rows = buildEntries({
      exercise: "  Overhead Press ",
      weight: 95,
      reps: 5,
      sets: 3,
      date: "2026-07-04",
      now: 1000,
    });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.id)).toEqual(["1000-0", "1000-1", "1000-2"]);
    expect(new Set(rows.map((r) => r.ts)).size).toBe(3);
    expect(rows[0].exercise).toBe("Overhead Press"); // trimmed
  });
});
