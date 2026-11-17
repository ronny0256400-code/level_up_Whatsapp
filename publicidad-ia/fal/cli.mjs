#!/usr/bin/env node
// Uso:
//   npm run fal:check                         → verifica clave, modelos y precios (gratis)
//   npm run fal:estimate -- --scene 4         → costo exacto de una escena (gratis)
//   npm run fal:estimate -- --all             → costo de todo el storyboard (gratis)
//   npm run fal:generate -- --scene 4 --step keyframe --confirm   → GENERA (de pago)
//   npm run fal:generate -- --scene 4 --step video --confirm      → GENERA (de pago)
//   npm run fal:ledger                        → registro de costos
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fal } from "@fal-ai/client";
import { MODELS, billableUnits, buildInput } from "./models.mjs";
import { SCENES, FIRST_TEST } from "./storyboard.mjs";
import {
  appendLedger, assertAffordable, budget, catalogStatus, estimate,
  readLedger, unitPrices, updateLedger, usd,
} from "./budget.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, "output");

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const sceneById = (id) => {
  const s = SCENES.find((x) => String(x.n) === String(id));
  if (!s) throw new Error(`Escena desconocida: ${id}`);
  return s;
};

/** Lista de trabajos (con costo) que requiere una escena. */
function jobsFor(scene) {
  if (!scene.model) return [];
  const jobs = [];
  if (scene.keyframe) jobs.push({ step: "keyframe", model: MODELS.keyframe, prompt: scene.keyframe });
  if (scene.endKeyframe) jobs.push({ step: "endKeyframe", model: MODELS.keyframe, prompt: scene.endKeyframe });
  jobs.push({ step: "video", model: MODELS[scene.model], prompt: scene.motion, duration: scene.duration });
  return jobs;
}

// Precio unitario consultado una sola vez (la API de estimación tiene límite de frecuencia).
let priceCache;
async function priceJobs(jobs) {
  priceCache ??= await unitPrices([...new Set(Object.values(MODELS).map((m) => m.id))]);
  let total = 0;
  for (const j of jobs) {
    j.units = billableUnits(j.model, j);
    j.cost = priceCache[j.model.id].unit_price * j.units;
    total += j.cost;
  }
  return total;
}

// ------------------------------------------------------------------ check
async function check() {
  console.log("1) Clave FAL_KEY:", process.env.FAL_KEY ? "presente (valor oculto)" : "NO encontrada");
  const ids = [...new Set(Object.values(MODELS).map((m) => m.id))];
  const [status, prices] = await Promise.all([catalogStatus(ids), unitPrices(ids)]);
  console.log("2) API de plataforma (api.fal.ai): OK, autenticada");
  console.log("3) Modelos:");
  for (const [k, m] of Object.entries(MODELS)) {
    const p = prices[m.id];
    console.log(
      `   - ${k.padEnd(10)} ${m.id}\n     estado: ${status[m.id] ?? "no encontrado"} · precio: ${p ? `$${p.unit_price} / ${p.unit}` : "?"}`,
    );
  }
  // Consulta de estado de una solicitud inexistente: valida la clave en la cola sin generar nada.
  const r = await fetch("https://queue.fal.run/fal-ai/kling-video/requests/00000000-0000-0000-0000-000000000000/status", {
    headers: { Authorization: `Key ${process.env.FAL_KEY}` },
  });
  console.log(
    `4) Cola de generación (queue.fal.run): HTTP ${r.status} → ${r.status === 404 ? "autenticada (solicitud de prueba inexistente, sin costo)" : r.status === 401 || r.status === 403 ? "CLAVE RECHAZADA" : "respuesta inesperada"}`,
  );
  const b = budget();
  console.log(`5) Presupuesto: tope ${usd(b.cap)} · comprometido ${usd(b.spent)} · disponible ${usd(b.remaining)}`);
  console.log("   No se ejecutó ninguna generación.");
}

// --------------------------------------------------------------- estimate
async function estimateCmd() {
  const scenes = flag("all") ? SCENES : [sceneById(opt("scene") ?? FIRST_TEST.scene)];
  let grand = 0;
  for (const s of scenes) {
    const jobs = jobsFor(s);
    if (!jobs.length) {
      console.log(`Escena ${s.n} · ${s.name}: sin IA (${s.note})`);
      continue;
    }
    const total = await priceJobs(jobs);
    grand += total;
    console.log(`Escena ${s.n} · ${s.name}`);
    for (const j of jobs) {
      console.log(`   ${j.step.padEnd(11)} ${j.model.id} · ${j.units} ${j.model.kind === "image" ? "MP" : "s"} → ${usd(j.cost)}`);
    }
    console.log(`   Total escena: ${usd(total)}`);
  }
  if (scenes.length > 1) console.log(`\nTOTAL (una toma por escena): ${usd(grand)}`);
  else {
    // Verificación cruzada con el estimador oficial de fal.ai
    let official = 0;
    for (const j of jobsFor(scenes[0])) official += await estimate(j.model.id, billableUnits(j.model, j));
    console.log(`Verificación con el estimador oficial de fal.ai: ${usd(official)}`);
  }
  console.log("Estimación hecha con la API de precios de fal.ai. No se generó nada.");
}

// --------------------------------------------------------------- generate
const dataUri = (file) => {
  const ext = path.extname(file).slice(1).replace("jpg", "jpeg");
  return `data:image/${ext};base64,${fs.readFileSync(file).toString("base64")}`;
};

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Descarga fallida ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

async function generate() {
  const scene = sceneById(opt("scene"));
  const step = opt("step");
  const job = jobsFor(scene).find((j) => j.step === step);
  if (!job) throw new Error(`La escena ${scene.n} no tiene el paso "${step}"`);
  const dir = path.join(OUT, `scene-${scene.n}`);
  fs.mkdirSync(dir, { recursive: true });

  if (job.model.kind === "video") {
    let start = path.join(dir, "keyframe.jpg");
    if (scene.startFrom) {
      const prev = path.join(OUT, `scene-${scene.startFrom}`, "clip.mp4");
      if (!fs.existsSync(prev)) throw new Error(`Primero genera el clip de la escena ${scene.startFrom}`);
      execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-sseof", "-0.1", "-i", prev, "-frames:v", "1", start]);
    }
    if (!fs.existsSync(start)) throw new Error(`Falta el fotograma clave: ${start}`);
    job.image = dataUri(start);
    const end = path.join(dir, "endKeyframe.jpg");
    if (scene.endKeyframe) {
      if (!fs.existsSync(end)) throw new Error(`Falta el fotograma final: ${end}`);
      job.endImage = dataUri(end);
    }
  }

  const input = buildInput(job.model, job);
  const units = billableUnits(job.model, job);
  const cost = await estimate(job.model.id, units);
  console.log(`Escena ${scene.n} · ${step} · ${job.model.id} · ${units} unidades → ${usd(cost)}`);
  if (flag("dry-run")) {
    console.log("dry-run: input preparado, no se envía:", JSON.stringify({ ...input, [job.model.imageField]: input[job.model.imageField] ? "<imagen>" : undefined, [job.model.endImageField]: input[job.model.endImageField] ? "<imagen>" : undefined }, null, 2));
    return;
  }
  assertAffordable(cost, { confirmed: flag("confirm") });

  fal.config({ credentials: process.env.FAL_KEY });
  let requestId;
  const result = await fal.subscribe(job.model.id, {
    input,
    logs: true,
    onEnqueue: (id) => {
      requestId = id;
      appendLedger({ scene: scene.n, step, endpoint: job.model.id, units, estimatedUsd: cost, requestId: id, status: "submitted" });
      console.log("Enviado a fal.ai, request_id:", id);
    },
    onQueueUpdate: (u) => u.status !== "COMPLETED" && process.stdout.write(`\r${u.status}   `),
  }).catch((e) => {
    if (requestId) updateLedger(requestId, { status: "failed", error: String(e.message ?? e) });
    throw e;
  });

  const url = result.data?.video?.url ?? result.data?.images?.[0]?.url;
  const file = path.join(dir, job.model.kind === "video" ? "clip.mp4" : `${step}.jpg`);
  await download(url, file);
  updateLedger(requestId, { status: "completed", file: path.relative(DIR, file), outputUrl: url });
  console.log(`\nGuardado: ${file}`);
}

function ledgerCmd() {
  const l = readLedger();
  for (const e of l.entries) console.log(`${e.at} · esc ${e.scene} · ${e.step} · ${e.endpoint} · ${usd(e.estimatedUsd)} · ${e.status}`);
  const b = budget();
  console.log(`Comprometido ${usd(b.spent)} de ${usd(b.cap)} · disponible ${usd(b.remaining)}`);
}

const cmds = { check, estimate: estimateCmd, generate, ledger: ledgerCmd };
if (!cmds[cmd]) {
  console.log("Comandos: check | estimate | generate | ledger");
  process.exit(1);
}
Promise.resolve(cmds[cmd]()).catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
