// Rasterize public/icon.svg into the PNG sizes the PWA manifest references.
// Run with: node scripts/gen-icons.mjs
import sharp from "sharp";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "public", "icon.svg"));

mkdirSync(join(root, "public", "icons"), { recursive: true });

const BG = "#14171A";

async function render(size, out) {
  // Maskable icons need the art inside a safe zone with the bg bleeding to edges;
  // our SVG already has a solid bg so it works for both "any" and "maskable".
  await sharp(svg, { density: 384 })
    .resize(size, size)
    .flatten({ background: BG })
    .png()
    .toFile(join(root, "public", out));
  console.log("wrote", out);
}

await render(192, "icons/icon-192.png");
await render(512, "icons/icon-512.png");
await render(512, "icons/icon-maskable-512.png");
await render(180, "apple-touch-icon.png");
