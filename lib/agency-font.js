"use strict";
const fs = require("node:fs"),
  path = require("node:path");
function agencyFont() {
  const preferred = path.join(__dirname, "../resources/fonts/NotoSans.ttf");
  const bundled = path.join(__dirname, "assets/fonts/NotoSans.ttf");
  const file = fs.existsSync(preferred) ? preferred : bundled;
  if (!fs.existsSync(file)) throw Error("AGENCY_FONT_UNAVAILABLE");
  return {
    loadSystemFonts: false,
    fontFiles: [file],
    defaultFontFamily: "Noto Sans",
    sansSerifFamily: "Noto Sans",
  };
}
module.exports = { agencyFont };
