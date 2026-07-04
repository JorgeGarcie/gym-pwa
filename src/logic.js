// Pure, side-effect-free helpers shared by the UI and covered by unit tests.
// Keeping these out of the component makes them trivial to test in isolation.

export const todayStr = () => new Date().toISOString().slice(0, 10);

export const fmtDate = (d) => {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};

export const timeAgo = (iso, now = Date.now()) => {
  if (!iso) return "never";
  const secs = Math.floor((now - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
};

// Sorted unique exercise names.
export const exerciseNames = (entries) =>
  Array.from(new Set(entries.map((e) => e.exercise))).sort();

// Entries for a given day, newest-logged first.
export const entriesForDate = (entries, date) =>
  entries.filter((e) => e.date === date).sort((a, b) => b.ts - a.ts);

// [date, entries][] sorted newest date first.
export const groupByDate = (entries) => {
  const groups = {};
  entries.forEach((e) => {
    (groups[e.date] ||= []).push(e);
  });
  return Object.entries(groups).sort((a, b) => (a[0] < b[0] ? 1 : -1));
};

// Best (heaviest) entry per exercise. Ties keep the first seen.
export const computePRs = (entries) => {
  const best = {};
  entries.forEach((e) => {
    if (!best[e.exercise] || e.weight > best[e.exercise].weight) {
      best[e.exercise] = e;
    }
  });
  return best;
};

// Chart series for one exercise, oldest -> newest.
export const buildChartData = (entries, exercise) => {
  if (!exercise) return [];
  return entries
    .filter((e) => e.exercise === exercise)
    .sort((a, b) => a.ts - b.ts)
    .map((e) => ({ date: fmtDate(e.date), weight: e.weight, label: `${e.weight}×${e.reps}` }));
};

// Union two entry lists by id. `remote` wins on id collisions (last-write-wins
// for cross-device restore). Order is not guaranteed; callers sort as needed.
export const mergeById = (local, remote) => {
  const byId = new Map(local.map((e) => [e.id, e]));
  remote.forEach((e) => byId.set(e.id, e));
  return Array.from(byId.values());
};

// Build the N set records produced by one "log set" action.
export const buildEntries = ({ exercise, weight, reps, sets, date, now = Date.now() }) => {
  const out = [];
  for (let i = 0; i < sets; i++) {
    out.push({
      id: `${now}-${i}`,
      ts: now + i,
      date,
      exercise: exercise.trim(),
      weight,
      reps,
    });
  }
  return out;
};
