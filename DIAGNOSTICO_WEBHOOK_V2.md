# Diagnóstico del fallo V2 — 2026-09-17

## Evidencia y alcance

Base local y SHA desplegado en Render: `7c39e65`, confirmado por el usuario. Se contrastó el flujo directamente con ese commit. Los logs adicionales repiten router comercial/nuevo, model_call LOW 185/0, Webhook falló http:null e ingress_retry, sin excepción ni stack. No se accedió a Render ni se desplegó. No se consultaron/modificaron hojas reales ni credenciales.

Los logs aportados NO contienen la excepción original. No permiten afirmar una causa raíz exacta del primer fallo. Sí permiten localizar defectos concretos de observabilidad y recuperación:

1. `lib/v2-models.js`, `respond`: `model_call` se emite después de resolver `client.responses.create`. Por tanto, ese evento no demuestra una excepción de la llamada OpenAI; tampoco prueba que la respuesta contenga texto útil. Antes se reemplazaban los errores de API por `Error de modelo`, perdiendo tipo, status, código y stack original.
2. `server.js`, catch de `procesarMensajeV2`: solo registraba `{http: Number(error.status) || null}`. El adaptador `entradaV2.processMessage` sustituía cualquier error por `Procesamiento pendiente`.
3. `lib/v2-ingress.js`, `flush/recover`: un grupo fallido permanecía en pending con vencimiento pasado, sin contador ni presupuesto. Cada recuperación podía ejecutarlo de nuevo indefinidamente.

En el recorrido comercial nuevo, LOW corresponde primero a `solicitaAtencionHumana`. Una respuesta sin texto devuelve clasificación indeterminada y continúa. Después se consulta el catálogo; después vienen persistencia del historial, extracción estructurada, modelo NORMAL y transporte. Se instrumentaron estas fronteras para distinguir los fallos.

## Reproducción, sin atribuirla a producción

El mock devuelve exactamente usage de 185/0, texto vacío y respuesta incomplete. Con catálogo válido, el webhook termina 200. Con stock inválido en el catálogo sintético, reproduce la secuencia observada y falla con `InventoryError`, código/mensaje `CATALOGO_INVALIDO`, etapa `inventory.catalog` y frames en `v2-inventory.js`/`server.js`. Esta es una hipótesis compatible, NO una confirmación de que el catálogo real esté mal.

Los clasificadores conservan su presupuesto existente de 16 tokens. El límite de salida de Responses incluye razonamiento y texto visible, según la [documentación oficial OpenAI](https://developers.openai.com/api/reference/typescript/resources/beta/subresources/responses/methods/create). Eso hace necesario observar status/incomplete_details; no demuestra que ese límite haya causado este incidente. No se modificaron modelo, presupuesto, prompts ni reglas de clasificación.

## Corrección local

- Nuevo `lib/v2-errors.js`: conserva la excepción original y agrega etapa mediante WeakMap; genera diagnóstico con nombre/tipo, mensaje seguro, código/status, frames archivo/línea/columna y causa anidada acotada.
- Por privacidad, mensajes arbitrarios de proveedores/JSON se sustituyen por una etiqueta y fingerprint; los mensajes estáticos conocidos se conservan. No se imprime el objeto Error completo ni request/response/body/headers/details. Los frames conservan posiciones originales, sin primera línea del stack ni rutas personales.
- `lib/v2-models.js`: propaga el error original; distingue selección, llamada y extracción de output_text. Usa el arreglo output si falta el helper. Registra status, incomplete_reason, has_text y reasoning_tokens sin registrar texto.
- `server.js`: instrumenta catálogo, parsing, carga/guardado de memoria y transporte YCloud; transmite la excepción original al ingreso. Se conservan los fallbacks de clasificación/extracción existentes.
- `lib/v2-ingress.js`: reserva cada intento en el almacenamiento existente antes de ejecutar; máximo tres intentos totales con esperas de 30 y 60 segundos. Un reinicio no reinicia el presupuesto. Errores permanentes conocidos pasan directamente a `failed`; transitorios o desconocidos agotan el presupuesto. `fetch failed` mantiene tratamiento transitorio y causa de red.
- Cuarentena: conserva hasta los últimos 100 grupos fallidos por número, con sus mensajes originales en el almacenamiento privado ya utilizado por la cola. No los imprime ni los ejecuta automáticamente. Los IDs siguen deduplicados; no se borran ventas, pedidos ni memoria comercial. No se añade comando de replay.
- No se cambia estructura/rangos/fórmulas de Sheets. El JSON de la cola existente incorpora intentos y fallos; no requiere una hoja nueva ni migración.

Si el almacenamiento de la cola falla, no se ejecuta una operación cuya reserva no pudo guardarse; se registra `ingress_storage_error`. Los chequeos de recuperación de almacenamiento pueden continuar, pero no consumen OpenAI ni ejecutan el mensaje sin reserva persistida. Se conserva el límite previo de una instancia Node y la imposibilidad de entrega exactamente una vez entre WhatsApp y persistencia ante caídas entre ambas operaciones.

## Pruebas

- Antes: npm test, 316 pruebas; 315 aprobadas, 0 fallidas, 1 omitida.
- Después: npm test, 333 pruebas; 332 aprobadas, 0 fallidas, 1 omitida.
- npm run check y git diff --check: correctos.
- 17 pruebas nuevas de diagnóstico: reproducción 185/0 con/sin catálogo inválido, error OpenAI original, selección, output_text ausente/inválido, JSON inválido sin PII, YCloud, persistencia posterior, permanente, backoff, reinicio, éxito tras reintento, reserva fallida, propagación webhook/ingress, secretos en errores, crash tras última reserva y TypeError de red transitorio.

Archivos: `server.js`, `lib/v2-errors.js`, `lib/v2-models.js`, `lib/v2-ingress.js`, `scripts/helpers/v2-runtime.js`, `scripts/test-v2-diagnostics.js`, `package.json` y este informe.

## Pendiente para cerrar la causa del incidente

El commit desplegado está confirmado; sigue faltando el error original de Render. Los logs antiguos no permiten reconstruir información que el código descartó. Cuando exista un evento diagnóstico, bastan stage, type/name, message seguro, code/status y frames para distinguir catálogo, modelo, parsing, YCloud o memoria. Este trabajo no desplegó la instrumentación y no afirma haber resuelto la condición específica de producción aún desconocida.
