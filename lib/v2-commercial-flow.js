"use strict";
const { norm, description, cityPages } = require("./v2-agencies");
const input = require("./v2-commercial-input");
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
  log = () => {},
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
    const trace = (rule, extra = {}) =>
      log({
        event: "commercial_stage",
        commercial_stage: flow.stage || "necesidad",
        rule_used: rule,
        model_called: false,
        selected_sku: flow.selected || null,
        ...extra,
      });
    const showSummary = async () => {
      const draft = c.borradorPedido;
      if (!draft || !complete(draft)) return false;
      Object.assign(draft, await resolve(draft));
      const content = summary(draft),
        fingerprint = require("node:crypto")
          .createHash("sha256")
          .update(content)
          .digest("hex");
      if (flow.summaryFingerprint === fingerprint) return true;
      if (
        flow.summaryDelivery?.fingerprint === fingerprint &&
        flow.summaryDelivery.estado === "reserved"
      )
        return false;
      flow.summaryDelivery = { fingerprint, estado: "reserved" };
      await save(number, c);
      try {
        await sendText(number, content, c);
      } catch (error) {
        if (
          Number(error.status) >= 400 &&
          Number(error.status) < 500 &&
          Number(error.status) !== 408
        ) {
          delete flow.summaryDelivery;
          await save(number, c);
        }
        throw error;
      }
      c.esperandoConfirmacionPedido = true;
      c.estado = "esperando_confirmacion";
      flow.summaryFingerprint = fingerprint;
      flow.summaryDelivery.estado = "sent";
      delete c.confirmationClassifierFailed;
      await save(number, c);
      return true;
    };
    // Capture personal fields before any question/media branch, including buffered input.
    if (flow.stage === "datos" && !audio && c.borradorPedido) {
      const data = input.capture(text, c.borradorPedido);
      if (Object.keys(data).length) {
        Object.assign(c.borradorPedido, data);
        await save(number, c);
        trace("capture", { customer_data_saved: true });
      }
    }
    if (input.greeting(text)) {
      trace("greeting");
      await sendText(
        number,
        "Hola 😊 ¿Cómo está? Cuénteme, ¿qué equipo está buscando o en qué le puedo ayudar?",
        c,
      );
      return;
    }
    if (input.deliveryQuestion(text)) {
      trace("delivery_time");
      if (input.preciseDelivery(text)) {
        await pending(number, c, text);
        return;
      }
      await sendText(
        number,
        "Normalmente el pedido llega aproximadamente entre 24 y 48 horas después del despacho.",
        c,
      );
      if (flow.stage === "datos") await showSummary();
      return;
    }
    if (input.mediaKind(text) && flow.selected) {
      const type = input.mediaKind(text);
      trace("media_request", { media_action: type });
      const result = await media(number, c, flow.selected, {
        type,
        requestKey: messageKey || "explicit:" + type,
      });
      if (!(type === "image" ? result.images : result.videos))
        await sendText(
          number,
          type === "image"
            ? "Permítame verificar las fotos disponibles de esta variante 😊"
            : "Permítame verificar el video disponible de esta variante 😊",
          c,
        );
      return;
    }

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
      /mayor capacidad|mas (?:capacidad|almacenamiento)/.test(n)
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
      flow.productCandidates = alternatives.map((p) => p.id_producto);
      await save(number, c);
      await sendText(
        number,
        `Claro 😊 Tenemos estas variantes con mayor capacidad:\n${alternatives.map((p) => `${p.producto} · ${p.capacidad} · ${p.color} · $${p.precio.toFixed(2)}`).join("\n")}\n¿Cuál le interesa?`,
        c,
      );
      return;
    }
    let selections = chooseProduct(items, text);
    if (
      flow.selected &&
      !selections.length &&
      ((correction && /color|capacidad|variante/.test(n)) ||
        /\d+\s*(?:gb|tb)\b/.test(n))
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
      const info = input.safeInformation(p);
      trace("variant_changed", { selected_sku: p.id_producto });
      await save(number, c);
      await tts.deliver(
        number,
        c,
        `${p.producto} · ${p.capacidad} · ${p.color}\n${info || "Ese dato no lo tengo registrado actualmente."}`,
        { key: messageKey + ":features" },
      );
      await media(number, c, p.id_producto);
      await sendText(number, `Precio: $${p.precio.toFixed(2)}.`, c);
      if (info === null) {
        await pending(
          number,
          c,
          "La información de la variante requiere verificación.",
        );
        return;
      }
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
      const info = input.safeInformation(p);
      trace("product_selected", { selected_sku: p.id_producto });
      await tts.deliver(
        number,
        c,
        `${p.producto} · ${p.capacidad} · ${p.color}\n${info || "Ese dato no lo tengo registrado actualmente."}`,
        { key: messageKey + ":features" },
      );
      if (info === null) {
        await pending(
          number,
          c,
          "La información de la variante requiere verificación.",
        );
        return;
      }
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
      const introduction = `¿Qué tal, estimado? ${delivered.images ? "Ahí le envío las características del equipo y las fotos. " : "Ahí le comparto las características del equipo. "}${delivered.videos ? "También le comparto su video. " : ""}Por favor indíqueme de qué ciudad y provincia nos escribe.${c.communicated.payment ? "" : " Realizamos envíos por Servientrega a nivel nacional y aceptamos pago contraentrega: usted paga única y exclusivamente al momento de retirar su producto."}`;
      c.communicated.payment = now().toISOString();
      await save(number, c);
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
        : input.safeInformation(p);
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
        answer = await language?.evidence(text, {
          ...snapshot.available.get(flow.selected),
          informacion: input.safeInformation(
            snapshot.available.get(flow.selected),
          ),
        });
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
      trace("agencies", {
        agency_city: draft.ciudad,
        agency_match_status: "city_resolved",
      });
      const signature = candidates.map((a) => a.id).join("|");
      if (flow.agencyShown !== signature) {
        flow.agencyShown = signature;
        await save(number, c);
        let pages;
        try {
          pages = cityPages(candidates);
        } catch {
          await sendText(
            number,
            candidates
              .map((a, i) => `${i + 1}. ${description(a)}`)
              .join("\n\n"),
            c,
          );
          pages = [];
        }
        for (const page of pages) {
          try {
            const result = await sendMedia(number, page.bytes, "image/png", c);
            if (result === false)
              throw Object.assign(Error("blocked"), { safeToFallback: true });
          } catch (error) {
            if (
              error.safeToFallback ||
              (Number(error.status) >= 400 && Number(error.status) < 500)
            )
              await sendText(
                number,
                page.agencies.map((a) => description(a)).join("\n\n"),
                c,
              );
            else log({ event: "agency_delivery_uncertain" });
          }
        }
      }
      await sendText(
        number,
        "Indíqueme por favor a cuál de estas agencias desea que le enviemos el equipo 😊",
        c,
      );
      return;
    }
    if (flow.stage === "agencia") {
      const candidates = flow.agencyCandidates
        .map((id) => agencies.all.find((a) => a.id === id))
        .filter(Boolean);
      if (n === norm(draft.provincia) || n === norm(draft.ciudad)) {
        trace("location_already_saved");
        return;
      }
      if (n === "mas" || n === "ver mas") {
        await sendText(
          number,
          "Le compartí todas las agencias disponibles en las imágenes. ¿Cuál le queda mejor? 😊",
          c,
        );
        return;
      }
      const selected =
        candidates.length === 1 &&
        /^(si|correcto|esa|esa agencia|de acuerdo|dale|confirmo)$/.test(n)
          ? candidates[0]
          : agencies.select(candidates, text);
      trace("agency_selection", {
        agency_city: draft.ciudad,
        agency_match_status: selected ? "unique" : "ambiguous",
      });
      if (!selected) {
        await sendText(
          number,
          "¿Cuál de estas agencias le queda mejor? Puede decirme su nombre o el sector 😊",
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
      const data =
        localLines || (!correction && draft.nombre && draft.cedula)
          ? null
          : await extract(c, JSON.stringify(items));
      if (data) {
        for (const key of ["nombre", "cedula"])
          if (data[key]) draft[key] = data[key];
        if (
          !localLines &&
          data.lineas?.length &&
          (correction ||
            data.lineas.every((l) => l.id_producto === flow.selected) ||
            /productos|equipos|\by\b/.test(n))
        )
          draft.lineas = data.lineas;
        await save(number, c);
        trace("capture", {
          customer_data_saved: !!(draft.nombre || draft.cedula),
          model_called: true,
        });
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
        await showSummary();
      } else {
        await save(number, c);
        await sendText(
          number,
          draft.nombre
            ? "¿Me comparte por favor su cédula para completar el resumen?"
            : draft.cedula
              ? "¿Me comparte por favor su nombre completo?"
              : "¿Me comparte por favor su nombre completo y cédula para completar el resumen?",
          c,
        );
      }
      return;
    }
    await pending(number, c, text);
  };
}
module.exports = { chooseProduct, createCommercialFlow };
