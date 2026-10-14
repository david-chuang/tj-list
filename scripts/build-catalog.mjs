// Builds data/catalog.json for the app from the Trader Joe's CSV exports in this folder.
// Usage: node scripts/build-catalog.mjs
//
// Inputs (either may be missing, but not both):
//   trader_joes_products.csv              full catalog: SKU, Product Name, Department, Category, Price (USD), Size, Unit
//   trader_joes_products_with_images.csv  in-stock catalog with the same fields (Price) plus Image URL
// Products are merged by SKU; the image export wins where both have a value.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sources = ["trader_joes_products.csv", "trader_joes_products_with_images.csv"]
  .map((f) => join(root, f))
  .filter((f) => existsSync(f));
const outPath = join(root, "data", "catalog.json");
const IMAGE_PREFIX = "https://www.traderjoes.com/content/dam/trjo/products/";

if (!sources.length) throw new Error("No trader_joes_products*.csv found in the project folder");

// Minimal RFC 4180 CSV parser (handles quoted fields, commas, and "" escapes).
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim()));
}

function readRecords(path) {
  const [header, ...rows] = parseCsv(readFileSync(path, "utf8").replace(/^﻿/, ""));
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

// Some exported names are ALL CAPS; title-case those so they read naturally.
function tidyName(name) {
  const n = name.replace(/\s+/g, " ");
  if (n !== n.toUpperCase()) return n;
  return n.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function categoryFor(dept, cat) {
  if (cat) return cat;
  if (/flower|plant|bouquet/i.test(dept)) return "Flowers & Plants";
  return "Other";
}

const UNITS = { "oz": "oz", "fl oz": "fl oz", "lb": "lb", "ml": "mL", "l": "L", "pint": "pint", "qt": "qt", "doz": "doz", "bag": "bag", "each": "each" };
function sizeLabel(size, unit) {
  const u = UNITS[unit.toLowerCase()] ?? unit;
  const n = Number(size);
  if (!u) return "";
  if (!size || !Number.isFinite(n)) return u;
  if (n === 1 && (u === "each" || u === "bag")) return u;
  const num = String(Math.round(n * 100) / 100);
  return u === "each" ? `${num} ct` : `${num} ${u}`;
}

// Merge every source by SKU; later sources fill in or override earlier ones.
const bySku = new Map();
for (const path of sources) {
  for (const r of readRecords(path)) {
    const name = tidyName(r["Product Name"] ?? "");
    if (!name || !r.SKU) continue;
    const price = Number(r["Price"] ?? r["Price (USD)"]);
    const image = (r["Image URL"] ?? "").startsWith(IMAGE_PREFIX) ? r["Image URL"].slice(IMAGE_PREFIX.length) : "";
    const prev = bySku.get(r.SKU) ?? {};
    bySku.set(r.SKU, {
      n: name,
      c: categoryFor(r.Department ?? "", r.Category ?? "") || prev.c,
      p: price > 0 ? price : prev.p,
      s: sizeLabel(r.Size ?? "", r.Unit ?? "") || prev.s,
      i: image || prev.i,
    });
  }
}

// One entry per product name (a few names repeat across sizes); prefer the one with a photo.
const byName = new Map();
for (const p of bySku.values()) {
  const key = p.n.toLowerCase();
  const cur = byName.get(key);
  if (!cur || (!cur.i && p.i)) byName.set(key, p);
}

// Compact output: drop empty fields to keep the file small.
const products = [...byName.values()]
  .sort((a, b) => a.n.localeCompare(b.n))
  .map((p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== "")));

// Prices are as of the newest export (local date, YYYY-MM-DD).
const d = new Date(Math.max(...sources.map((f) => statSync(f).mtimeMs)));
const asOf = [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((x) => String(x).padStart(2, "0")).join("-");
writeFileSync(outPath, JSON.stringify({ asOf, products }));

const withPrice = products.filter((p) => p.p).length, withImage = products.filter((p) => p.i).length;
console.log(`Wrote ${products.length} products to data/catalog.json (prices as of ${asOf})`);
console.log(`  with price: ${withPrice}   with photo: ${withImage}`);
