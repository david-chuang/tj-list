// Converts trader_joes_products.csv into data/catalog.json for the app.
// Usage: node scripts/build-catalog.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const csvPath = join(root, "trader_joes_products.csv");
const outPath = join(root, "data", "catalog.json");

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

// Some exported names are ALL CAPS; title-case those so they read naturally.
function tidyName(name) {
  const n = name.trim().replace(/\s+/g, " ");
  if (n !== n.toUpperCase()) return n;
  return n.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function categoryFor(dept, cat) {
  if (cat.trim()) return cat.trim();
  if (/flower|plant|bouquet/i.test(dept)) return "Flowers & Plants";
  return "Other";
}

const [header, ...rows] = parseCsv(readFileSync(csvPath, "utf8").replace(/^﻿/, ""));
const col = (name) => header.indexOf(name);
const iName = col("Product Name"), iDept = col("Department"), iCat = col("Category");

const seen = new Map();
for (const r of rows) {
  const name = tidyName(r[iName] ?? "");
  if (!name) continue;
  const key = name.toLowerCase();
  if (!seen.has(key)) seen.set(key, { n: name, c: categoryFor(r[iDept] ?? "", r[iCat] ?? "") });
}

const catalog = [...seen.values()].sort((a, b) => a.n.localeCompare(b.n));
writeFileSync(outPath, JSON.stringify(catalog));

const counts = {};
for (const p of catalog) counts[p.c] = (counts[p.c] ?? 0) + 1;
console.log(`Wrote ${catalog.length} products to data/catalog.json`);
console.table(counts);
