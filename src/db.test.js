// Exercises the real IndexedDB access layer against `fake-indexeddb`, an
// in-memory implementation of the IndexedDB API. No browser required.
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  getAllEntries,
  putEntry,
  putEntries,
  deleteEntry,
  clearEntries,
  getEntriesByExercise,
} from "./db";

const mk = (id, exercise, weight, date) => ({
  id: String(id),
  exercise,
  weight,
  reps: 5,
  date,
  ts: Number(id),
});

describe("db (IndexedDB via fake-indexeddb)", () => {
  beforeEach(async () => {
    await clearEntries();
  });

  it("puts and reads back a single entry", async () => {
    await putEntry(mk(1, "Bench Press", 185, "2026-07-01"));
    const all = await getAllEntries();
    expect(all).toHaveLength(1);
    expect(all[0].exercise).toBe("Bench Press");
  });

  it("upserts on matching id (no duplicate)", async () => {
    await putEntry(mk(1, "Bench Press", 185, "2026-07-01"));
    await putEntry(mk(1, "Bench Press", 200, "2026-07-01")); // same id
    const all = await getAllEntries();
    expect(all).toHaveLength(1);
    expect(all[0].weight).toBe(200);
  });

  it("bulk-puts a batch atomically", async () => {
    await putEntries([
      mk(1, "Squat", 275, "2026-07-01"),
      mk(2, "Squat", 285, "2026-07-02"),
      mk(3, "Bench Press", 185, "2026-07-02"),
    ]);
    expect(await getAllEntries()).toHaveLength(3);
  });

  it("queries by the exercise index", async () => {
    await putEntries([
      mk(1, "Squat", 275, "2026-07-01"),
      mk(2, "Bench Press", 185, "2026-07-01"),
      mk(3, "Squat", 285, "2026-07-02"),
    ]);
    const squats = await getEntriesByExercise("Squat");
    expect(squats).toHaveLength(2);
    expect(squats.every((r) => r.exercise === "Squat")).toBe(true);
  });

  it("deletes by id", async () => {
    await putEntries([mk(1, "Squat", 275, "2026-07-01"), mk(2, "Squat", 285, "2026-07-02")]);
    await deleteEntry("1");
    const all = await getAllEntries();
    expect(all.map((r) => r.id)).toEqual(["2"]);
  });

  it("clears the store", async () => {
    await putEntries([mk(1, "Squat", 275, "2026-07-01")]);
    await clearEntries();
    expect(await getAllEntries()).toHaveLength(0);
  });
});
