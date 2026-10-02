"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { norm } = require("./v2-agencies");
const digest = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");
function loadMediaFacts(root, products) {
  const file = path.join(root, "media-facts.json");
  if (!fs.existsSync(file)) return {};
  const source = JSON.parse(fs.readFileSync(file, "utf8")),
    result = {};
  for (const [sku, files] of Object.entries(products)) {
    const records = source[sku];
    if (!records) continue;
    result[sku] = [...(records.images || []), ...(records.videos || [])].filter(
      (record) => {
        const actual = files.find(
          (item) =>
            item.type === record.type &&
            path.relative(path.join(root, "productos", sku), item.path) ===
              record.file,
        );
        return (
          actual &&
          record.sha256 === digest(fs.readFileSync(actual.path)) &&
          Array.isArray(record.canAnswer) &&
          record.canAnswer.every((q) => typeof q === "string")
        );
      },
    );
  }
  return result;
}
function sentFacts(resources, context) {
  const files = resources.products[context.sku] || [];
  return (resources.mediaFacts?.[context.sku] || []).filter((record) => {
    const actual = files.find((item) => item.type === record.type);
    return (
      actual &&
      path.basename(actual.path) === path.basename(record.file) &&
      context.presentation?.sentMedia?.some(
        (sent) =>
          sent.file === path.basename(actual.path) &&
          sent.sha256 === record.sha256 &&
          sent.type === record.type,
      )
    );
  });
}
function answerFact(resources, context, question) {
  return sentFacts(resources, context).find((record) =>
    record.canAnswer.some((q) => norm(q) === norm(question)),
  );
}
module.exports = { loadMediaFacts, sentFacts, answerFact, digest };
