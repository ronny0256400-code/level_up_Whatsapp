"use strict";
const fs = require("node:fs"),
  path = require("node:path");
function files(root, sku) {
  if (!/^[A-Za-z0-9_-]+$/.test(sku)) return [];
  const base = path.resolve(root, sku);
  if (!fs.existsSync(base) || fs.lstatSync(base).isSymbolicLink()) return [];
  return [
    ["imagen", "image", /\.(jpg|jpeg|png)$/i],
    ["video", "video", /\.mp4$/i],
  ].flatMap(([dir, type, re]) => {
    const p = path.join(base, dir);
    if (!fs.existsSync(p) || fs.lstatSync(p).isSymbolicLink()) return [];
    return fs
      .readdirSync(p)
      .filter(
        (n) => re.test(n) && !fs.lstatSync(path.join(p, n)).isSymbolicLink(),
      )
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((n) => ({
        path: path.join(p, n),
        type,
        mime:
          type === "video"
            ? "video/mp4"
            : /png$/i.test(n)
              ? "image/png"
              : "image/jpeg",
      }));
  });
}
function createProductMedia({ root, catalog, save, send, log = () => {} }) {
  return async (number, c, sku) => {
    const current = await catalog();
    if (!current.available.has(sku)) return { images: 0, videos: 0 };
    c.mediaDelivered ||= {};
    const result = { images: 0, videos: 0 };
    for (const f of files(root, sku)) {
      const key = sku + "/" + path.basename(f.path);
      if (c.mediaDelivered[key] === "sent") {
        result[f.type === "image" ? "images" : "videos"]++;
        continue;
      }
      if (c.mediaDelivered[key]) continue;
      c.mediaDelivered[key] = "reserved";
      await save(number, c);
      try {
        if (!(await catalog()).available.has(sku)) break;
        const ok = await send(number, fs.readFileSync(f.path), f.mime, c);
        if (ok === false) {
          c.mediaDelivered[key] = "blocked";
        } else {
          c.mediaDelivered[key] = "sent";
          result[f.type === "image" ? "images" : "videos"]++;
        }
      } catch {
        c.mediaDelivered[key] = "failed";
        log({ event: "product_media_failed", type: f.type });
      }
      await save(number, c);
    }
    return result;
  };
}
module.exports = { files, createProductMedia };
