"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process");
const files = [
  "server.js",
  ...fs
    .readdirSync("lib")
    .filter((f) => f.endsWith(".js"))
    .map((f) => path.join("lib", f)),
];
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax OK: ${files.length} files`);
