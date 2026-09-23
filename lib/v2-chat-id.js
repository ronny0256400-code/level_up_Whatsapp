"use strict";
function createChatIds({ readCounter, saveCounter, readOrders }) {
  let queue = Promise.resolve();
  return () => {
    const work = queue
      .catch(() => {})
      .then(async () => {
        const rows = await readOrders(),
          ids = new Set(
            rows.flatMap(({ conversacion: c }) =>
              [c, ...(c.oportunidades || [])]
                .map((x) => x.pedido?.id_chat)
                .filter(Boolean),
            ),
          );
        const counter = await readCounter();
        let n = Math.max(
          Number(counter.next) || 1,
          ...[...ids].map((x) => Number(x.slice(2)) + 1),
        );
        if (!Number.isSafeInteger(n)) throw Error("CHAT_COUNTER_INVALID");
        let id;
        do {
          id = `CH${String(n++).padStart(6, "0")}`;
        } while (ids.has(id));
        await saveCounter({ next: n });
        return id;
      });
    queue = work;
    return work;
  };
}
module.exports = { createChatIds };
