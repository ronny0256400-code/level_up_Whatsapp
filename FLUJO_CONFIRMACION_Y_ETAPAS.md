# Flujo de confirmación y conversación progresiva

Validación local con mocks, sin despliegue ni llamadas reales a proveedores o Sheets.

## Estados persistidos

| Acción | Conversación / pedido | human_takeover | Comportamiento |
|---|---|---|---|
| Confirmar resumen | confirmado / confirmado | true | Cierre breve único, aviso administrativo existente; mensajes normales en silencio |
| GUIA | enviado / enviado | true | Venta registrada por la implementación existente; conserva pausa |
| LIBERAR antes de GUIA | confirmado / confirmado | false | Solo coordinación logística; no recopila datos ni abre otra venta |
| LIBERAR después de GUIA | enviado / enviado | false | Seguimiento logístico con guía; no reinicia venta |

Pausa, pedido, cierre y marcadores comerciales se guardan en el JSON de MEMORIA. GUIA, inventario, fórmulas, generación de ID, aviso administrativo y LLEGO conservan su implementación.

## Audio y cierre

Meta y YCloud transcriben y pasan por el mismo pipeline de texto. La composición «sí, confirmo los datos del pedido» se normaliza en la entrada compartida antes del reconocedor aprobado, sin modificar sus reglas ni crear un clasificador para audio. Las 35 pruebas anteriores de confirmación siguen pasando.

Mensaje final:

> ¡Pedido confirmado! 😊 Un asesor se pondrá en contacto contigo por este mismo chat para coordinar la agencia de Servientrega y continuar con el proceso de envío.

pedido.cierreCliente se persiste pendiente junto al pedido/pausa; se reserva como enviando antes del transporte y se marca enviada con confirmationReplySent al completar. Solo este cierre puede atravesar su propia pausa automática, mediante permiso interno. TOMAR, postventa y no_contactar siguen bloqueando envíos.

Un rechazo explícito permite reintento del scheduler después de 60 segundos. Timeout, error 5xx o reinicio con reserva enviando dejan estado incierta y requieren conciliación humana; no se reenvían ciegamente. Este diseño evita duplicar un cierre potencialmente aceptado, pero no promete entrega exactamente una vez entre sistemas sin transacción compartida.

## Mensajes por etapas

lib/v2-commerce.js selecciona producto, características, incluye, envío, compra o datos. Las respuestas informativas usan instrucciones acotadas por tema (máximo solicitado de 80 palabras) y el catálogo vigente; su redacción sigue dependiendo del modelo. No se antepone publicidad, proceso completo ni video automático. Se mantienen las restricciones de catálogo cerrado, variantes, disponibilidad, agencias y datos internos.

Compra emite una explicación fija breve y pregunta si desea registrar. La aceptación habilita extracción y solicitud fija de datos faltantes. El teléfono se obtiene de WhatsApp. El resumen y el cierre son determinísticos. El historial y commerce.shippingExplained evitan volver a introducir información ya explicada; una consulta explícita puede volver a responder ese tema.

## Pruebas

Antes: 421 total, 420 aprobadas, 0 fallidas, 1 omitida.
Después: 437 total, 436 aprobadas, 0 fallidas, 1 omitida.

16 pruebas nuevas en scripts/test-flujo-progresivo.js cubren proveedores, texto/audio, persistencia/reinicio, duplicados, pausa, GUIA, LIBERAR/logística, etapas, TEST_MODE y fallos del cierre. Las pruebas de venta anteriores que exigían el bloque largo/video automático ahora validan el comportamiento autorizado. Las pruebas de extracción/confirmación preparan explícitamente la fase de registro aceptado; el nuevo recorrido completo verifica la aceptación real por webhook.

npm test, npm run check y git diff --check completados correctamente.

Archivos de esta entrega: server.js, lib/v2-commerce.js, package.json, SPEC.md, este informe; scripts/test-flujo-progresivo.js, scripts/test-venta-real.js, scripts/test-confirmacion-guia.js, scripts/test-v2-runtime.js y scripts/test-v2-diagnostics.js. Se conservaron las modificaciones previas aprobadas de confirmación ya presentes en el workspace.
