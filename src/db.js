// IndexedDB access layer for the gym tracker.
//
// We use `idb` (a tiny promise wrapper over the raw IndexedDB API) so every
// operation is awaitable. Everything the rest of the app needs to touch storage
// goes through the helpers exported here — no component talks to IndexedDB
// directly.

import { openDB } from "idb";

const DB_NAME = "gym-tracker";
const DB_VERSION = 1;
const STORE = "entries";

// A single shared connection promise. openDB is called once; every helper
// awaits this same promise instead of reopening the database each time.
let dbPromise;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      // `upgrade` runs only when the DB is first created or DB_VERSION changes.
      // This is the ONLY place you're allowed to alter the schema (create
      // stores / indexes). Bump DB_VERSION whenever you change what's in here.
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          // keyPath: "id" means each record's own `id` field is its primary key.
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          // Secondary indexes: let us query by date or exercise without
          // scanning every record. Not unique — many entries share a date.
          store.createIndex("date", "date");
          store.createIndex("exercise", "exercise");
        }
      },
    });
  }
  return dbPromise;
}

// Read every entry back as a plain array (the shape the UI already expects).
export async function getAllEntries() {
  const db = await getDB();
  return db.getAll(STORE);
}

// Insert or update one entry. `put` is an upsert: keyed by `id`, so re-putting
// the same id overwrites it. Used both for new sets and for synced-in records.
export async function putEntry(entry) {
  const db = await getDB();
  return db.put(STORE, entry);
}

// Bulk upsert inside a single transaction — all writes commit together or not
// at all. Used when restoring / merging a batch pulled from Drive.
export async function putEntries(entries) {
  const db = await getDB();
  const tx = db.transaction(STORE, "readwrite");
  await Promise.all([...entries.map((e) => tx.store.put(e)), tx.done]);
}

export async function deleteEntry(id) {
  const db = await getDB();
  return db.delete(STORE, id);
}

// Wipe the store (used before a full restore-from-Drive replace).
export async function clearEntries() {
  const db = await getDB();
  return db.clear(STORE);
}

// Example of an index query: fetch one exercise's history straight from the
// `exercise` index instead of filtering the whole store in JS.
export async function getEntriesByExercise(exercise) {
  const db = await getDB();
  return db.getAllFromIndex(STORE, "exercise", exercise);
}
