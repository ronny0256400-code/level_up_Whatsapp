# V4 simplified — MVP aislado

Mensaje → intérprete IA → `{ action, params }` → validación contra fuentes oficiales → respuesta → contexto mínimo.

`lib/v4-flow.js` es un flujo nuevo. No utiliza `createSalesFlow`, la máquina de estados V3, su historial ni sus pausas. Reutiliza únicamente `phone`/`command` como funciones puras, normalización de agencias, catálogo oficial, descubrimiento de recursos y transporte YCloud. No se modificaron los proveedores ni las rutas de webhook existentes.

## Uso y pruebas

`npm run test:v4` ejecuta simulaciones sin red ni credenciales. `npm test` incluye también estas regresiones.

`createRuntime` de `lib/v4-runtime.js` recibe `env`, cliente Sheets y OpenAI, además de proveedores opcionales para pruebas. No carga `.env`, no inicia HTTP ni registra webhooks. `handleMessage` recibe el objeto inbound normalizado del proveedor existente. Respeta el ID inbound real para leído/typing, filtra ecos y deduplica hasta 1000 eventos en memoria. Por cada respuesta: markRead → typing → 5000 ms → texto o bloque. Un fallo de leído/typing no impide enviar. La presentación sube y envía foto, video, texto íntegro oficial y Comercial 1. No reutiliza la cola V3 ni su espera.

El webhook local usa V3 por defecto y permite activar V4 con `USE_V4=true`, sin cambiar el webhook remoto. Las simulaciones validan la lógica y los contratos; no demuestran entregas reales ni precisión del modelo real.

## Contexto y selección

Contexto por teléfono con familia, selectedSku interno, filtros, location, customer, step. `alternatives` guarda hasta cuatro IDs internos para resolver opciones numeradas. El contexto predeterminado es en memoria y se pierde al reiniciar; se puede inyectar un store. No se escribe Google Sheets.

MacBook comienza con la pregunta aprobada, sin catálogo. Los filtros numéricos aceptan un valor exacto o `{ min, max, target }`. RAM/almacenamiento en GB; TB se convierten a GB. Atributos inexistentes no se presuponen. Mínimos y máximos son restricciones; target ordena por cercanía. Hasta cuatro alternativas disponibles, sin SKU en los listados. Recomendación elige el primer candidato compatible por cercanía y después stock. Windows enumera exclusivamente las cinco marcas aprobadas que tengan stock. iPad lista modelo y almacenamiento. Una selección ambigua pide aclaración; seleccionar por descripción puede necesitar una segunda interpretación con catálogo oficial.

Catálogo reutiliza `PAGINA DE STOCK` A2:H2/A3:H y su caché de 30 segundos. Una copia caducada no se presenta como stock vigente. Precio y características siempre son de Sheets; campos comerciales inventados por IA se ignoran. La información de presentación se envía íntegra. Si esa información contiene el SKU interno, se solicita revisión humana, en lugar de reescribirla.

Las preguntas auxiliares conservan step. Textos de garantía, ubicación, envío e incluidos provienen de los TXT oficiales. Las preguntas técnicas conocidas usan el texto oficial del producto. Datos técnicos no registrados, política de pago no configurada y postventa requieren humano. Las preguntas desconocidas se reinterpretan con el producto seleccionado y los textos oficiales; si siguen sin resolverse, se pide aclaración, sin generar datos comerciales.

Errores técnicos normales no crean PAUSED. La derivación real usa `handoff` y requiere liberar al chat antes de continuar. El callback `escalate` es inyectable y debe conectarse al administrador antes de una prueba real; sin callback se registra `v4_human_required`, sin enviar notificaciones externas. `/liberar` y `/borrar` solo son aceptados desde ASESOR_WHATSAPP y no activan typing.

## Alcance pendiente

Steps declarados: START, PRODUCT_SELECTION, PRESENTATION, LOCATION, AGENCY, CUSTOMER_DATA, CONFIRMATION, CONFIRMED. El MVP llega hasta LOCATION después de presentar. SET_LOCATION, SELECT_AGENCY, SET_CUSTOMER_DATA y CONFIRM se reconocen, pero no tramitan ni confirman pedidos. CORRECTION solo modifica familia/filtros y vuelve a selección.

Pendientes: persistencia/deduplicación durable, transcripción inbound de audio, transporte de notificaciones al administrador, agencias y resto del pedido/logística. El proveedor de agencias existente está disponible para la siguiente fase; no se ejecuta todavía. También falta prueba manual real de interpretación y entrega. No ejecutar simultáneamente V3 y V4 para el mismo inbound.

No push, deploy, cambios de secrets, modificaciones de Sheets ni alteraciones de backup-v3-final.

## Conexión local configurable

El servidor local permite `USE_V4=true`. Solo el callback local de `/ycloud/webhook` cambia de ruta; firmas y webhook remoto permanecen iguales. V4 procesa en segundo plano tras aceptar el evento, sin la cola Sheets ni la segunda espera de V3. Sus errores tienen diagnósticos seguros. Se desactivan las tareas de recuperación/purga V3 mientras está activa la bandera. `/liberar` y `/borrar` operan en el contexto en memoria de V4; con la bandera ausente o distinta de `true` conservan el funcionamiento V3. El endpoint Meta conserva su comportamiento anterior.

Arranque manual local, sin editar `.env`:

```sh
USE_V4=true node --env-file=.env server.js
```

El reinicio pierde contexto y deduplicación V4. Para volver a V3, detener el proceso V4 y ejecutar `USE_V4=false node --env-file=.env server.js`. No ejecutar ambos procesos sobre el mismo webhook. No se modifican ni migran los datos de V3.

## Motor de decisión comercial

`v4-decision.js` añade restricciones exact/min/max para RAM y almacenamiento, exact/max para presupuesto, preferencia de precio (lowest/balanced/highest) y prioridad de almacenamiento alto. Valida stock disponible, aplica restricciones duras y ordena opciones; MacBook muestra hasta tres alternativas. Si no hay coincidencia exacta, puede ofrecer mayor RAM/almacenamiento explicando la diferencia; no relaja CPU, mínimos, máximos ni presupuesto.

`lastOptions` guarda temporalmente SKU interno, etiqueta, precio y atributos oficiales de las últimas opciones. Referencias por ordinal, precio, capacidad y etiqueta completa se resuelven contra esa lista y se validan nuevamente con stock. Una ambigüedad pregunta por diferencias concretas. Fotos/características de un equipo seleccionado usan REQUEST_PRESENTATION; una única opción reciente también permite avanzar. Tras el bloque se pide ciudad y provincia, sin implementar aún la logística. Las consultas auxiliares mantienen su etapa. El fallback genérico queda para mensajes sin intención ni contexto comercial utilizable.

## Selección y presentación automática

Una única coincidencia compatible, una referencia inequívoca o la aceptación de una sola opción durante PRODUCT_SELECTION inicia presentación sin pregunta intermedia. `selectedSku` y PRESENTATION se guardan antes de leído/typing y de la única espera. Se envían fotos, video, información íntegra y Comercial 1; `presentedSku` se registra al completar el bloque y se continúa en LOCATION. Un simple sí/interés no repite multimedia ni confirma un pedido. Una solicitud explícita de fotos/video permite reenviar. Alternativas que difieren de restricciones exactas requieren aceptación y se muestran sin numeración cuando solo hay una.
