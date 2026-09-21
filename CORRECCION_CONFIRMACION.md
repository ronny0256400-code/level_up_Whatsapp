# Confirmación determinística — 2026-09-21

## Causa raíz

En server.js, esConfirmacionAfirmativa reconocía un conjunto incompleto de frases. «Es correcto», «Confirmo los datos del pedido» y «Confirmar los datos del pedido» no pasaban ese filtro. Antes de resolver el pedido se llamaba al clasificador de atención humana, limitado a max_output_tokens:16. La respuesta incomplete/max_output_tokens/sin texto devolvía null y el handler preguntaba otra vez si el cliente quería asesor, corrección o confirmación. No había marcador persistido que evitara repetir ese mismo fallback en mensajes posteriores.

## Corrección

clasificacionLocalConfirmacion normaliza mayúsculas/tildes/puntuación/espacios y aplica prioridades: asesor explícito, corrección, negación y finalmente aceptación inequívoca. Las frases solicitadas y sus variantes normalizadas confirman localmente. Las aceptaciones mixtas con cambios («Es correcto el precio pero cambia la ciudad») no confirman. Se conserva el comportamiento previo de atención al asesor y de extracción/corrección de datos.

El handler compartido por texto y audio consulta esa decisión antes de llamar a clasificadores. Solo si no existe decisión local consulta LOW (atención humana y, cuando corresponde, confirmación semántica). La extracción estructurada de datos durante una corrección no es un clasificador de aceptación y no se modificó.

Se elevó de 16 a 512 el presupuesto de salida de los dos clasificadores de compra. No se modificó el clasificador de retiro ni el modelo elegido por entorno. Un presupuesto mayor no garantiza que nunca haya respuestas incompletas: se comprueba el estado y se rechazan como fallo controlado, incluso si contienen una etiqueta parcial ACEPTA.

falloClasificacionConfirmacion persiste confirmationClassifierFailed en MEMORIA antes de la indicación al cliente. No altera estado, borrador ni pedido. La indicación explica que el resumen sigue pendiente y ofrece confirmar/corregir/pedir asesor explícitamente. Mientras ese marcador está activo, nuevos mensajes ambiguos no vuelven a llamar LOW ni repiten la pregunta. Las opciones explícitas siguen operativas y un nuevo resumen borra el marcador. El comportamiento sobrevive reinicios.

Después de enviar la respuesta de pedido confirmado se persiste pedido.confirmationReplySent. Repeticiones y webhooks duplicados no producen otra respuesta de confirmación ni otro aviso administrativo en los escenarios probados. No se añade una garantía transaccional entre transporte y Sheets ante caídas entre aceptación y persistencia; se conserva el límite general de esas APIs.

## Validación

Antes: npm test completo, 386 pruebas, 385 aprobadas, 0 fallidas, 1 omitida.
Después: npm test completo, 421 pruebas, 420 aprobadas, 0 fallidas, 1 omitida.
npm run check y git diff --check: correctos.

35 pruebas nuevas cubren todas las frases obligatorias, variantes normalizadas, negaciones/correcciones, asesor, datos corregidos en nuevo resumen, audio transcrito sin llamada posterior de modelo, mensaje ambiguo legítimo, LOW incomplete sin texto en ambos clasificadores, etiqueta parcial en respuesta incomplete y recuperación tras reinicio.

Cada aceptación comprueba ID persistido, estado confirmado, un solo mensaje de confirmación, un solo aviso administrativo, stock todavía 3 y cero ventas nuevas. Las pruebas de GUIA existentes continúan pasando. Algunas pruebas previas de venta ahora esperan cero llamadas de clasificación para correcciones/negaciones resueltas localmente; no se eliminó su validación de que no confirman.

Archivos: server.js, scripts/test-confirmacion-deterministica.js (nuevo), scripts/test-venta-real.js, package.json, SPEC.md y este informe. Sin cambios en GUIA, LLEGO ni el adaptador de inventario. Sin despliegue ni llamadas de producción.
