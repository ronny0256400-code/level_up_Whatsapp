"use strict";
const { normalize } = require("./v2-policy");
// Shared input normalization for text and transcribed confirmation.
function confirmationInput(text) {
  return normalize(text).replace(
    /^si\s*[,;:!]?\s+(?=confirmo\b|confirmar\b)/,
    "",
  );
}
module.exports = { confirmationInput };
