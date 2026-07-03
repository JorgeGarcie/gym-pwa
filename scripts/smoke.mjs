// Headless smoke test: load the preview build, log a set, confirm it lands in
// IndexedDB and survives a reload.
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173";

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});
const page = await browser.newPage();
const errors = [];
// Only care about real JS exceptions. External resource failures (e.g. Google
// Fonts blocked by a sandboxed network) are not app bugs.
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(BASE, { waitUntil: "networkidle" });

// Fill the quick-add form.
await page.fill('input[placeholder^="Exercise"]', "Bench Press");
await page.fill('input[placeholder="lbs"]', "185");
await page.fill('input[placeholder="reps"]', "5");
await page.click("text=LOG SET");

await page.waitForSelector("text=Today's Session");
await page.waitForSelector("text=Personal Records");

// Read straight out of IndexedDB to prove persistence, not just React state.
const count = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open("gym-tracker", 1);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return new Promise((res) => {
    const tx = db.transaction("entries", "readonly");
    const req = tx.objectStore("entries").getAll();
    req.onsuccess = () => res(req.result.length);
  });
});

// Reload and confirm the entry is still rendered (loaded from IndexedDB).
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("text=Bench Press");

await browser.close();

if (count < 1) {
  console.error("FAIL: expected >=1 entry in IndexedDB, got", count);
  process.exit(1);
}
if (errors.length) {
  console.error("FAIL: page errors:\n" + errors.join("\n"));
  process.exit(1);
}
console.log(`PASS: ${count} entry persisted in IndexedDB and survived reload.`);
