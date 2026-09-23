"use strict";
const { norm, description, card } = require("./v2-agencies");
const { promotion } = require("./v2-calendar");
function chooseProduct(items, text) {
  const n = norm(text);
  const exact = items.filter((p) =>
    (" " + n + " ").includes(" " + norm(p.id_producto) + " "),
  );
  if (exact.length) return exact;
  let found = items.filter((p) =>
    (" " + n + " ").includes(" " + norm(p.producto) + " "),
  );
  if (!found.length && /\b(laptop|computador|portatil|chromebook)\b/.test(n))
    found = items.filter((p) => /chromebook|laptop|portatil/i.test(p.producto));
  if (!found.length && /\bipad\b/.test(n))
    found = items.filter((p) => /ipad/i.test(p.producto));
  for (const field of ["capacidad", "color"]) {
    const narrowed = found.filter((p) => n.includes(norm(p[field])));
    if (narrowed.length) found = narrowed;
  }
  return found;
}
function createCommercialFlow({
  agencies,
  save,
  sendText,
  sendMedia,
  media,
  tts,
  extract,
  resolve,
  summary,
  complete,
  pending,
  language,
  now = () => new Date(),
}) {
  return async (
    number,
    c,
    text,
    snapshot,
    { audio = false, correction = false, messageKey } = {},
  ) => {
    c.commerce ||= {};
    const flow = c.commerce;
    c.historial ||= [];
    c.historial.push({ role: "user", content: text });
    const items = [...snapshot.available.values()],
      n = norm(text);
    if (
      !correction &&
      /\b(como pago|forma de pago|contraentrega|cuanto (?:cuesta|vale) el envio|envio gratis)\b/.test(
        n,
      )
    ) {
      await save(number, c);
      await sendText(
        number,
        "El envío es gratis por Servientrega. El pago es contraentrega al retirar en la agencia elegida, sin adelantos.",
        c,
      );
      return;
    }
    if (
      /\b(donde estan|donde quedan|tienen local|ubicacion de ustedes|sus bodegas)\b/.test(
        n,
      )
    ) {
      await tts.deliver(number, c, require("./v2-final-rules").warehouse, {
        key: messageKey,
      });
      return;
    }
    if (/\b(me pagan|fin de mes|no tengo dinero|cuando cobre)\b/.test(n)) {
      await sendText(
        number,
        "Puedes escribirnos cuando estés listo; revisaremos la disponibilidad y el precio vigentes en ese momento.",
        c,
      );
      return;
    }
    if (
      flow.selected &&
      /mayor capacidad|mas (?:capacidad|almacenamiento)|(?:64|128|256|512) gb/.test(
        n,
      )
    ) {
      const current = snapshot.available.get(flow.selected);
      const alternatives = items.filter(
        (p) =>
          p.producto === current?.producto &&
          parseInt(p.capacidad) > parseInt(current.capacidad),
      );
      if (!alternatives.length) {
        await tts.deliver(
          number,
          c,
          "Actualmente no disponemos de una versión con mayor capacidad. Google Drive o iCloud permiten guardar archivos en la nube y liberar espacio local; no aumentan la memoria física ni el almacenamiento interno del dispositivo.",
          { key: messageKey },
        );
        return;
      }
    }
    let selections = chooseProduct(items, text);
    if (
      flow.selected &&
      correction &&
      !selections.length &&
      /color|capacidad|variante/.test(n)
    ) {
      const current = snapshot.available.get(flow.selected);
      selections = items.filter(
        (p) =>
          p.producto === current?.producto &&
          [p.color, p.capacidad].some((v) =>
            (" " + n + " ").includes(" " + norm(v) + " "),
          ),
      );
      if (selections.length !== 1) {
        await pending(number, c, text);
        return;
      }
    }
    let localLines = false;
    const quantity =
      /(?:cantidad(?: de)?|quiero|llevo|serian|sean) (\d+)(?: equipos?| unidades?)?\b/.exec(
        n,
      );
    if (
      flow.selected &&
      selections.length === 1 &&
      selections[0].id_producto !== flow.selected &&
      !/[?¿]/.test(text)
    ) {
      const p = selections[0];
      flow.selected = p.id_producto;
      c.borradorPedido.lineas = [
        {
          id_producto: p.id_producto,
          producto: p.producto,
          capacidad: p.capacidad,
          color: p.color,
          cantidad: 1,
          precio_unitario: p.precio,
        },
      ];
      delete c.borradorPedido.manualOffer;
      localLines = true;
      flow.stage = c.borradorPedido.agencia ? "datos" : "ubicacion";
    }
    if (
      flow.selected &&
      quantity &&
      Number(quantity[1]) > 0 &&
      c.borradorPedido?.lineas?.length === 1
    ) {
      c.borradorPedido.lineas[0].cantidad = Number(quantity[1]);
      if (c.borradorPedido.manualOffer?.cantidad !== Number(quantity[1]))
        delete c.borradorPedido.manualOffer;
      localLines = true;
      flow.stage = c.borradorPedido.agencia ? "datos" : "ubicacion";
    }
    if (
      !flow.selected &&
      !selections.length &&
      flow.productCandidates?.length
    ) {
      const candidates = flow.productCandidates
        .map((id) => snapshot.available.get(id))
        .filter(Boolean);
      if (/^\d+$/.test(n) && candidates[Number(n) - 1])
        selections = [candidates[Number(n) - 1]];
      else
        selections = candidates.filter((p) =>
          ["capacidad", "color"].some((key) =>
            (" " + n + " ").includes(" " + norm(p[key]) + " "),
          ),
        );
    }
    if (
      !flow.selected &&
      !selections.length &&
      language &&
      (/\b(tableta|computadora|portatil|ipad|laptop|chromebook|dell)\b/.test(
        n,
      ) ||
        flow.productCandidates?.length)
    ) {
      try {
        const selected = await language.select(text, items);
        if (selected) selections = [selected];
      } catch {
        /* Closed candidates remain the fallback. */
      }
    }
    if (!flow.selected && /\bgarantia\b/.test(n)) {
      await pending(number, c, text);
      return;
    }
    if (
      !flow.selected &&
      !selections.length &&
      /[?¿]/.test(text) &&
      !/producto|equipo|ipad|laptop|chromebook|computadora/.test(n)
    ) {
      await pending(number, c, text);
      return;
    }
    if (!flow.selected) {
      if (selections.length !== 1) {
        const choices = selections.length ? selections : items;
        flow.productCandidates = choices.map((p) => p.id_producto);
        await save(number, c);
        await sendText(
          number,
          choices.length
            ? `Estas son las opciones disponibles:\n${choices.map((p, i) => `${i + 1}. ${p.producto} · ${p.capacidad} · ${p.color} · $${p.precio.toFixed(2)}`).join("\n")}\n¿Cuál deseas?`
            : "No hay variantes disponibles en este momento.",
          c,
        );
        return;
      }
      flow.selected = selections[0].id_producto;
      flow.stage = "ubicacion";
      c.estado = "interesado";
      const p = selections[0];
      c.borradorPedido = {
        telefono: number,
        lineas: [
          {
            id_producto: p.id_producto,
            producto: p.producto,
            capacidad: p.capacidad,
            color: p.color,
            cantidad: 1,
            precio_unitario: p.precio,
          },
        ],
      };
      await save(number, c);
      await sendText(
        number,
        `${p.producto} · ${p.capacidad} · ${p.color}\n${p.informacion || "Las características adicionales requieren verificación con un asesor."}`,
        c,
      );
      const delivered = await media(number, c, p.id_producto);
      c.communicated ||= {};
      const recent =
        c.communicated.promotion &&
        now().getTime() - Date.parse(c.communicated.promotion) < 86400000;
      await sendText(
        number,
        `Precio: $${p.precio.toFixed(2)}.${recent ? "" : " " + promotion(now())}`,
        c,
      );
      c.communicated.promotion = now().toISOString();
      await save(number, c);
      const introduction = `Soy la voz generada por IA del asistente de Level Up Store. ${delivered.images ? "Te envié las fotos comerciales del modelo. " : ""}${delivered.videos ? "También puedes revisar su video comercial. " : ""}El asesor enviará el video de tu equipo y empaque después de confirmar. El pago es contraentrega: pagas al retirar en Servientrega, sin adelantos. ¿En qué ciudad y provincia te encuentras? Así te muestro las agencias disponibles para que elijas dónde retirar.`;
      await tts.deliver(number, c, introduction, {
        force: true,
        key: "comercial1:" + p.id_producto,
      });
      await save(number, c);
      return;
    }
    if (!snapshot.available.has(flow.selected)) {
      await pending(number, c, text);
      return;
    }
    if (
      /\b(caracteristicas|especificaciones|incluye|precio|promocion|vigente)\b/.test(
        n,
      ) &&
      !c.esperandoConfirmacionPedido &&
      !correction
    ) {
      const p = snapshot.available.get(flow.selected);
      const answer = /precio|promocion|vigente/.test(n)
        ? `Precio: $${p.precio.toFixed(2)}. ${promotion(now())}`
        : p.informacion;
      if (!answer) await pending(number, c, text);
      else
        await tts.deliver(number, c, answer, {
          critical: /precio|promocion|vigente/.test(n),
          key: messageKey,
        });
      return;
    }
    if (
      !correction &&
      (/[?¿]/.test(text) ||
        /\b(dura|bateria|compatible|aplicacion|resolucion|almacenamiento)\b/.test(
          n,
        )) &&
      !/agencia|ciudad|provincia/.test(n)
    ) {
      let answer;
      try {
        answer = await language?.evidence(
          text,
          snapshot.available.get(flow.selected),
        );
      } catch {}
      if (answer) await tts.deliver(number, c, answer, { key: messageKey });
      else await pending(number, c, text);
      return;
    }
    const draft = c.borradorPedido || {};
    if (flow.stage === "ubicacion") {
      const ps = [...new Set(agencies.all.map((a) => a.provincia))].filter(
        (p) => n.includes(norm(p)),
      );
      const cs = [...new Set(agencies.all.map((a) => a.ciudad))].filter((p) =>
        n.includes(norm(p)),
      );
      if (ps.length === 1) draft.provincia = ps[0];
      if (cs.length === 1) draft.ciudad = cs[0];
      const inferred = agencies.find(draft.provincia, draft.ciudad || text);
      if (inferred.length) {
        draft.provincia = inferred[0].provincia;
        draft.ciudad = inferred[0].ciudad;
      }
      if (!draft.provincia || !draft.ciudad) {
        const data = await extract(c, JSON.stringify(items));
        if (data?.provincia) draft.provincia = data.provincia;
        if (data?.ciudad) draft.ciudad = data.ciudad;
      }
      const candidates = agencies.find(draft.provincia, draft.ciudad);
      c.borradorPedido = draft;
      await save(number, c);
      if (!candidates.length) {
        await sendText(
          number,
          "Indícame tu ciudad y provincia para verificar una agencia disponible. Si tu localidad no aparece, un asesor deberá revisarlo.",
          c,
        );
        return;
      }
      draft.provincia = candidates[0].provincia;
      draft.ciudad = candidates[0].ciudad;
      flow.agencyCandidates = candidates.map((a) => a.id);
      flow.stage = "agencia";
      await save(number, c);
      for (const a of candidates.slice(0, 5)) {
        try {
          const ok = await sendMedia(number, card(a), "image/png", c);
          if (ok === false) throw Error("blocked");
        } catch {
          await sendText(number, description(a), c);
        }
      }
      await sendText(
        number,
        candidates.length === 1
          ? `${candidates[0].nombre}\nIndíqueme por favor a cuál de estas agencias desea que le enviemos el equipo 😊`
          : `Selecciona una agencia por su número:\n${candidates
              .slice(0, 10)
              .map((a, i) => `${i + 1}. ${a.nombre} · ${a.direccion}`)
              .join(
                "\n",
              )}\nTambién puedes indicar sector/dirección o escribir más.\nIndíqueme por favor a cuál de estas agencias desea que le enviemos el equipo 😊`,
        c,
      );
      return;
    }
    if (flow.stage === "agencia") {
      const candidates = agencies.all.filter((a) =>
        flow.agencyCandidates.includes(a.id),
      );
      if (n === "mas" || n === "ver mas") {
        flow.agencyPage =
          ((flow.agencyPage || 0) + 1) % Math.ceil(candidates.length / 10);
        await save(number, c);
        await sendText(
          number,
          candidates
            .slice(flow.agencyPage * 10, flow.agencyPage * 10 + 10)
            .map(
              (a, i) =>
                `${flow.agencyPage * 10 + i + 1}. ${a.nombre} · ${a.direccion}`,
            )
            .join("\n") + "\nPuedes elegir por número o escribir más.",
          c,
        );
        return;
      }
      const selected =
        candidates.length === 1 &&
        /^(si|correcto|esa|esa agencia|de acuerdo|dale|confirmo)$/.test(n)
          ? candidates[0]
          : agencies.select(candidates, text);
      if (!selected) {
        await sendText(
          number,
          "Indica el número o nombre de la agencia que deseas; no he seleccionado ninguna todavía.",
          c,
        );
        return;
      }
      draft.agencia = {
        id: selected.id,
        nombre: selected.nombre,
        direccion: selected.direccion,
        provincia: selected.provincia,
        ciudad: selected.ciudad,
      };
      draft.provincia = selected.provincia;
      draft.ciudad = selected.ciudad;
      flow.stage = "datos";
      c.estado = "recopilando_datos";
      await save(number, c);
      if (draft.nombre && draft.cedula) {
        Object.assign(draft, await resolve(draft));
        c.esperandoConfirmacionPedido = true;
        c.estado = "esperando_confirmacion";
        await save(number, c);
        await sendText(number, summary(draft), c);
        return;
      }
      await sendText(
        number,
        `Agencia seleccionada: ${selected.nombre}. ${selected.direccion}\nEscribe tu nombre completo y cédula. Usaremos este número de WhatsApp para el pedido.`,
        c,
      );
      return;
    }
    if (flow.stage === "datos") {
      if (audio) {
        await sendText(
          number,
          "Por favor escribe tu nombre completo y cédula por texto para registrar correctamente estos datos.",
          c,
        );
        return;
      }
      const data = localLines ? null : await extract(c, JSON.stringify(items));
      if (data) {
        for (const key of ["nombre", "cedula"])
          if (data[key]) draft[key] = data[key];
        if (!localLines && data.lineas?.length) draft.lineas = data.lineas;
      }
      try {
        Object.assign(draft, await resolve(draft));
      } catch {
        await pending(number, c, text);
        return;
      }
      draft.telefono = number;
      c.borradorPedido = draft;
      if (complete(draft)) {
        await save(number, c);
        await sendText(number, summary(draft), c);
        c.esperandoConfirmacionPedido = true;
        c.estado = "esperando_confirmacion";
        delete c.confirmationClassifierFailed;
        await save(number, c);
      } else {
        await save(number, c);
        await sendText(
          number,
          "Escribe tu nombre completo y cédula para completar el resumen.",
          c,
        );
      }
      return;
    }
    await pending(number, c, text);
  };
}
module.exports = { chooseProduct, createCommercialFlow };
