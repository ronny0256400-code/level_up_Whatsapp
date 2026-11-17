// Precios en vivo (API de fal.ai) + registro de costos + control de presupuesto.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
export const LEDGER = path.join(DIR, "ledger.json");
const API = "https://api.fal.ai/v1";

function headers() {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("Falta FAL_KEY (en .env o en el entorno).");
  return { Authorization: `Key ${key}`, "content-type": "application/json" };
}

async function api(pathname, init = {}, tries = 4) {
  const res = await fetch(`${API}${pathname}`, { ...init, headers: headers() });
  if (res.status === 429 && tries > 1) {
    await new Promise((r) => setTimeout(r, 2000 * (5 - tries)));
    return api(pathname, init, tries - 1);
  }
  const body = await res.text();
  if (!res.ok) throw new Error(`fal.ai ${pathname} → HTTP ${res.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body);
}

/** Estado en el catálogo (active/deprecated) de cada endpoint. Gratis. */
export async function catalogStatus(ids) {
  const q = ids.map((id) => `endpoint_id=${encodeURIComponent(id)}`).join("&");
  const d = await api(`/models?${q}`);
  return Object.fromEntries(d.models.map((m) => [m.endpoint_id, m.metadata?.status ?? "?"]));
}

/** Precio unitario actual de cada endpoint. Gratis. */
export async function unitPrices(ids) {
  const q = ids.map((id) => `endpoint_id=${encodeURIComponent(id)}`).join("&");
  const d = await api(`/models/pricing?${q}`);
  return Object.fromEntries(d.prices.map((p) => [p.endpoint_id, p]));
}

/** Costo estimado por fal.ai para una cantidad de unidades. Gratis, no genera nada. */
export async function estimate(endpointId, units) {
  const d = await api(`/models/pricing/estimate`, {
    method: "POST",
    body: JSON.stringify({
      estimate_type: "unit_price",
      endpoints: { [endpointId]: { unit_quantity: units } },
    }),
  });
  return d.total_cost;
}

// ---------------------------------------------------------------- registro
export function readLedger() {
  if (!fs.existsSync(LEDGER)) return { entries: [] };
  return JSON.parse(fs.readFileSync(LEDGER, "utf8"));
}

export function appendLedger(entry) {
  const l = readLedger();
  l.entries.push({ at: new Date().toISOString(), ...entry });
  fs.writeFileSync(LEDGER, JSON.stringify(l, null, 2) + "\n");
}

export function updateLedger(requestId, patch) {
  const l = readLedger();
  const e = l.entries.find((x) => x.requestId === requestId);
  if (e) Object.assign(e, patch, { updatedAt: new Date().toISOString() });
  fs.writeFileSync(LEDGER, JSON.stringify(l, null, 2) + "\n");
}

/** Gasto comprometido: todo lo enviado a fal.ai (excepto lo que falló antes de cobrarse). */
export function committedSpend() {
  return readLedger()
    .entries.filter((e) => e.status !== "rejected")
    .reduce((s, e) => s + (e.estimatedUsd ?? 0), 0);
}

export function budget() {
  const cap = Number(process.env.FAL_BUDGET_USD ?? 0);
  const spent = committedSpend();
  return { cap, spent, remaining: Math.max(0, cap - spent) };
}

/** Lanza un error si la generación no está autorizada o excede el presupuesto. */
export function assertAffordable(costUsd, { confirmed }) {
  const b = budget();
  if (!confirmed) throw new Error("Generación bloqueada: falta --confirm (autorización explícita).");
  if (b.cap <= 0) throw new Error("Generación bloqueada: FAL_BUDGET_USD es 0. Fija un presupuesto en .env.");
  if (costUsd > b.remaining + 1e-9) {
    throw new Error(
      `Presupuesto insuficiente: costo ${usd(costUsd)} > disponible ${usd(b.remaining)} (tope ${usd(b.cap)}, comprometido ${usd(b.spent)}).`,
    );
  }
  return b;
}

export const usd = (n) => `$${n.toFixed(4)} USD`;
