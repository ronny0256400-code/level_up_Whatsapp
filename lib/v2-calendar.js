"use strict";
const HOUR = 3600000;
const local = (d) => new Date(new Date(d).getTime() - 5 * HOUR);
const utc = (d) => new Date(d.getTime() + 5 * HOUR);
function nextWindow(date) {
  const d = local(date);
  for (;;) {
    const day = d.getUTCDay(),
      end = day === 6 ? 12 : 17;
    if (day === 0 || d.getUTCHours() >= end) {
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(8, 0, 0, 0);
      continue;
    }
    if (d.getUTCHours() < 8) d.setUTCHours(8, 0, 0, 0);
    return utc(d);
  }
}
function pickupDeadline(arrival) {
  const d = local(nextWindow(arrival));
  let days = 1;
  while (days < 3) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0) days++;
  }
  d.setUTCHours(d.getUTCDay() === 6 ? 12 : 17, 0, 0, 0);
  return utc(d);
}
function promotion(now) {
  const d = local(now),
    day = d.getUTCDate(),
    end =
      day <= 15
        ? 15
        : new Date(
            Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
          ).getUTCDate();
  return `${day <= 10 ? "Promoción de inicio de mes. " : ""}Envío gratis. Vigente hasta el ${end}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}, únicamente hasta agotar stock.`;
}
module.exports = { nextWindow, pickupDeadline, promotion };
