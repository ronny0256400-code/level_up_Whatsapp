"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { discover } = require("../lib/sales-resources"),
  { createAgencies } = require("../lib/v2-agencies");
const root = path.join(__dirname, "../resources"),
  resources = discover(root);
const agencyRoot = fs.existsSync(path.join(root, "Ecuador"))
  ? path.join(root, "Ecuador")
  : path.join(root, "agencias/Ecuador");
const agencies = createAgencies(agencyRoot),
  cityFiles = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "__MACOSX" || e.isSymbolicLink())
      continue;
    const file = path.join(dir, e.name);
    if (e.isDirectory()) walk(file);
    else if (/\.html$/i.test(e.name))
      cityFiles.push({
        province: path.basename(path.dirname(path.dirname(file))),
        city: path.basename(path.dirname(file)),
        html: path.relative(path.join(__dirname, ".."), file),
      });
  }
}
walk(agencyRoot);
const relative = (file) => path.relative(path.join(__dirname, ".."), file);
const hash = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const productSummary = Object.entries(resources.products).map(
  ([sku, files]) => ({
    sku,
    images: files.filter((f) => f.type === "image").length,
    videos: files.filter((f) => f.type === "video").length,
  }),
);
const missingImages = productSummary.filter((p) => !p.images).map((p) => p.sku);
const missingVideos = productSummary.filter((p) => !p.videos).map((p) => p.sku);
const mediaGroups = new Map(),
  oversizedMedia = [];
for (const [sku, files] of Object.entries(resources.products))
  for (const file of files) {
    const digest = hash(file.path),
      item = { sku, path: relative(file.path), type: file.type };
    const group = mediaGroups.get(digest) || [];
    group.push(item);
    mediaGroups.set(digest, group);
    const bytes = fs.statSync(file.path).size,
      limitBytes = (file.type === "image" ? 5 : 16) * 1024 * 1024;
    if (bytes > limitBytes) oversizedMedia.push({ ...item, bytes, limitBytes });
  }
const transcriptsMissing = Object.entries(resources.audios)
  .filter(([, a]) => !a.text)
  .map(([intent, a]) => ({
    intent,
    audio: relative(a.path),
    txt: relative(a.path.replace(/\.[^.]+$/, ".txt")),
  }));
const locationSources = {};
for (const filename of [
  "ALIASES_UBICACIONES.json",
  "MANIFIESTO_ECUADOR.json",
]) {
  const file = path.join(agencyRoot, filename);
  if (fs.existsSync(file)) {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    locationSources[filename] = { path: relative(file), sha256: hash(file) };
    if (filename === "ALIASES_UBICACIONES.json")
      locationSources[filename].aliases = data;
    else
      locationSources[filename].validation = {
        files: Object.keys(data.archivos || {}).length,
        mismatches: Object.entries(data.archivos || {})
          .filter(([name, record]) => {
            const target = path.join(agencyRoot, name);
            return !fs.existsSync(target) || hash(target) !== record.sha256;
          })
          .map(([name]) => name),
      };
  }
}
const { agencyFont } = require("../lib/agency-font");
const manifest = {
  products: Object.fromEntries(
    Object.entries(resources.products).map(([sku, files]) => [
      sku,
      files.map((f) => ({
        ...f,
        path: path.relative(path.join(__dirname, ".."), f.path),
        bytes: fs.statSync(f.path).size,
        sha256: hash(f.path),
      })),
    ]),
  ),
  audios: Object.fromEntries(
    Object.entries(resources.audios).map(([intent, a]) => [
      intent,
      {
        ...a,
        path: relative(a.path),
        bytes: fs.statSync(a.path).size,
        sha256: hash(a.path),
        transcriptPath: relative(a.path.replace(/\.[^.]+$/, ".txt")),
      },
    ]),
  ),
  errors: resources.errors,
  agencies: agencies.stats,
  cityFiles,
  agencyRoot: relative(agencyRoot),
  provinces: fs
    .readdirSync(agencyRoot, { withFileTypes: true })
    .filter(
      (e) =>
        e.isDirectory() && !e.name.startsWith(".") && e.name !== "__MACOSX",
    )
    .map((e) => e.name)
    .sort(),
  productSummary,
  locationSources,
  reusedMedia: [...mediaGroups]
    .filter(([, files]) => files.length > 1)
    .map(([sha256, files]) => ({ sha256, files })),
  diagnostics: {
    missingImages,
    missingVideos,
    transcriptsMissing,
    oversizedMedia,
    missingAgencyFont: !fs.existsSync(agencyFont().fontFiles[0]),
    agencyFont: relative(agencyFont().fontFiles[0]),
    mediaMismatches: Object.entries(resources.mediaFacts).flatMap(
      ([sku, records]) =>
        records
          .filter((r) => r.resourceMismatch)
          .map((r) => ({ sku, file: r.file, issue: r.resourceMismatch })),
    ),
    mediaFactsFiles: Object.values(resources.mediaFacts).reduce(
      (n, records) => n + records.length,
      0,
    ),
  },
};
fs.writeFileSync(
  path.join(__dirname, "../docs/resources-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    sku: Object.keys(manifest.products).length,
    audios: Object.keys(manifest.audios).length,
    agencies: agencies.stats,
    errors: manifest.errors,
    photos: productSummary.reduce((n, p) => n + p.images, 0),
    videos: productSummary.reduce((n, p) => n + p.videos, 0),
    agencyRoot: manifest.agencyRoot,
    missingImages,
    missingVideos,
    transcriptsMissing: transcriptsMissing.length,
    oversizedMedia: oversizedMedia.length,
    missingAgencyFont: manifest.diagnostics.missingAgencyFont,
  }),
);
