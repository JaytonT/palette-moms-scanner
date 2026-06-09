// One-off: create $1..$50 SERVICE products in the Palette Moms GHL store and
// file each into a price-tier collection ($10/$20/$30/$40/$50). $1-$9 get no
// collection. Idempotent-ish: skips a product if one with the same name already
// exists. Run: node scripts/create-dollar-products.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dir, "..", ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const TOKEN = env.VITE_GHL_API_KEY;
const LOC = env.VITE_GHL_LOCATION_ID;
const BASE = "https://services.leadconnectorhq.com";
const H = {
  Authorization: `Bearer ${TOKEN}`,
  Version: "2021-07-28",
  "Content-Type": "application/json",
};

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

// --- 1. ensure tier collections exist, keyed by tens value ---
async function ensureCollections() {
  const existing = (
    await api(
      "GET",
      `/products/collections?altId=${LOC}&altType=location&limit=100`
    )
  ).data;
  const byName = new Map(existing.map((c) => [c.name, c._id]));
  const tiers = [10, 20, 30, 40, 50];
  const ids = {};
  for (const t of tiers) {
    const name = `$${t}`;
    if (byName.has(name)) {
      ids[t] = byName.get(name);
      console.log(`collection ${name} exists -> ${ids[t]}`);
    } else {
      const created = await api("POST", `/products/collections`, {
        altId: LOC,
        altType: "location",
        name,
        slug: String(t),
      });
      ids[t] = (created.data ?? created)._id;
      console.log(`collection ${name} CREATED -> ${ids[t]}`);
    }
  }
  return ids;
}

function tierFor(amount, ids) {
  if (amount < 10) return [];
  const tens = Math.min(Math.floor(amount / 10) * 10, 50);
  return [ids[tens]];
}

// existing product names so we don't double-create on a re-run
async function existingNames() {
  const names = new Set();
  let offset = 0;
  for (;;) {
    const page = await api(
      "GET",
      `/products/?locationId=${LOC}&limit=100&offset=${offset}`
    );
    const arr = page.products ?? [];
    for (const p of arr) names.add(p.name);
    if (arr.length < 100) break;
    offset += 100;
  }
  return names;
}

async function createOne(n, ids, present) {
  const name = `$${n}`;
  if (present.has(name)) {
    console.log(`skip ${name} (already exists)`);
    return;
  }
  const product = await api("POST", `/products/`, {
    name,
    locationId: LOC,
    productType: "SERVICE",
    availableInStore: true,
    collectionIds: tierFor(n, ids),
  });
  const id = product._id ?? product.product?._id;
  await api("POST", `/products/${id}/price`, {
    name,
    type: "one_time",
    currency: "USD",
    amount: n,
    locationId: LOC,
  });
  const coll = tierFor(n, ids).length ? `(coll $${Math.min(Math.floor(n / 10) * 10, 50)})` : "(no coll)";
  console.log(`created ${name} -> ${id} ${coll}`);
}

async function pool(items, limit, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < items.length) await fn(items[i++]);
    })
  );
}

const ids = await ensureCollections();
const present = await existingNames();
const nums = Array.from({ length: 50 }, (_, i) => i + 1);
await pool(nums, 4, (n) => createOne(n, ids, present));
console.log("done.");
