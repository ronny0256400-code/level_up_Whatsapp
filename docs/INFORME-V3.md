# Informe de implementación V3 — 1 de octubre de 2026

La versión comercial nueva está implementada y validada localmente. **Todavía no es posible habilitar el flujo real completo con este checkout**: faltan audios oficiales y multimedia de numerosos SKU, incluidos MacBook. Esas ausencias generan pausa documentada; no se fabricaron recursos ni transcripciones.

No se hizo push, deploy, modificación de producción, cambio de secretos, migración de Sheets ni reconfiguración del número viejo de Meta. No se ejecutaron pruebas contra servicios externos con credenciales reales.

## A. Arquitectura encontrada

Node/Express, `server.js` monolítico de 1.900 líneas, Google Sheets para catálogo y memoria, OpenAI Responses/transcripción, YCloud y compatibilidad Meta. El repositorio estaba limpio antes de editar. `AGENTS.md` está vacío.

El ingreso común `v2-ingress` implementa deduplicación, buffer de cinco segundos, límite de frecuencia y recuperación durable con reintentos acotados. `ycloud-webhook` verifica firma sobre el cuerpo original; Meta usa HMAC y verificación GET. Rutas existentes: `/ycloud/webhook` y `/webhook`.

La versión V2.5 mezclaba venta con comandos logísticos, registro de ventas, avisos de llegada/retiro, seguimiento, ofertas manuales y TTS. Se identificaron módulos de inventario, memoria, políticas, multimedia, agencias, horarios, outboxes y pruebas V1/V2/V2.5.

La inspección física encontró **244 archivos** útiles en recursos: 233 HTML, 6 JPG, 3 MP4 y dos archivos de fuente/licencia. El parser leyó todos los HTML sin errores: 24 provincias, 233 ciudades y 679 agencias. La ruta real de agencias es `resources/agencias/Ecuador`, no `resources/Ecuador`. No existe `resources/Audios`, ni archivos de alias/manifiesto previos. Los nueve archivos multimedia originales permanecen intactos.

## B. Archivos modificados

- `server.js`: entrada activa V3, transporte, rutas y mantenimiento, sin logística posterior.
- `.env.example`: nombre configurable, YCloud, malls y hechos visibles de videos, sin credenciales.
- `README.md`: documentación operativa de V3 y límites reales.
- `SPEC.md`: especificación completa proporcionada en esta solicitud.
- `package.json`: V3 dentro de `npm test`; scripts `test:sales`, `test:legacy`, `test:v25` y `audit:resources`.
- `lib/v2-ingress.js`: comandos con slash inmediatos y descarte de pendientes por número.
- `lib/ycloud-client.js`: PDF de hasta 100 MB y operaciones de leído/escribiendo con timeout corto.
- `lib/ycloud-webhook.js`: conserva también el ID inbound de YCloud para leído/escribiendo, además de wamid para dedup.
- `scripts/helpers/v2-runtime.js`, `scripts/test-v1.js`, `scripts/test-venta-real.js`, `scripts/test-ciclo-administrativo.js`, `scripts/test-ycloud-webhook.js`: apuntan las pruebas históricas al código V2.5 archivado, conservando sus assertions. El título del test HTTP histórico indica ahora que prueba V2.5.

## C. Archivos nuevos

- `lib/sales-flow.js`: state machine, políticas, resumen, pausa, comandos y purga.
- `lib/sales-catalog.js`: lectura estricta y exclusiva del catálogo oficial.
- `lib/sales-store.js`: memoria compatible con A:C, teléfonos canónicos y JSON fragmentado.
- `lib/sales-interpreter.js`: clasificación/extracción semántica con OpenAI.
- `lib/sales-resources.js`: descubrimiento y salida PNG/PDF de agencias.
- `lib/sales-technical.js`: respuestas técnicas controladas.
- `scripts/test-sales.js`: 64 pruebas unitarias/integradas locales de V3.
- `scripts/test-sales-webhook.js`: servidor activo, firmas, cola, comandos y venta completa; 7 pruebas incluyendo subtests.
- `scripts/audit-sales-resources.js`: auditoría reproducible sin llamadas externas.
- `docs/resources-manifest.json`: SKU → multimedia y provincia/ciudad → HTML.
- `docs/INFORME-V3.md`: este informe.
- `legacy/server-v25.js`, `legacy/SPEC-V25.md`: copia del código/contrato anteriores para pruebas históricas, fuera de ejecución productiva.

## D. Funciones desactivadas

El servidor activo no importa el servidor archivado. No arranca scheduler de retiros ni ejecuta GUIA, LLEGO, RETIRADO, CANCELADO, PAGO, IR, RESPONDER, TOMAR o DERIVAR. No crea guías, registros de ventas, cuadros de ventas, seguimientos, avisos de retiro/postventa, descuentos automáticos, cuentas bancarias o decrementos de stock. No usa TTS improvisado.

Se conservaron los módulos viejos compartidos y las pruebas. `sales-catalog` reutiliza únicamente `parseCatalog`; no construye el adaptador que expone `register`/`updateState`. La prueba del servidor V3 verifica las escrituras de una venta completa: únicamente memoria, sin cambios a stock o ventas.

## E. State machine nuevo

Etapas activas: `PRODUCT → PRESENTATION → CITY → DELIVERY` (solo cuando Guayaquil necesita elegir modalidad) `→ DESTINATION → DATA → CONFIRMATION`. La variante queda representada por el SKU exacto; el intérprete no debe elegir una variante ambigua. Los datos disponibles se capturan y persisten antes de respuestas/multimedia, aunque lleguen mezclados con preguntas.

Estados: `ACTIVE`, `PAUSED_CONFIRMED`, `PAUSED_ESCALATION`, `PAUSED_CLAIM`. El servidor comprueba la pausa antes de descargar/transcribir audio o ejecutar la venta. Los webhooks de chats pausados se confirman sin añadir trabajo comercial a la cola. Permanecen las lecturas necesarias para verificar la pausa, sin llamadas a OpenAI ni respuestas.

Las preguntas auxiliares responden mediante política/ficha/audio y conservan datos. Las recomendaciones sin requisitos usan el mayor stock; con requisitos se filtra primero por compatibilidad interpretada. Los empates conservan cualquiera de los empatados. Comparaciones usan fichas de los SKU, sin comparar cantidades de stock.

Solo se confirma cuando existe un resumen vigente y completo y la interpretación semántica es positiva, sin corrección, negación, pregunta o cambio de datos. Precios y disponibilidad se vuelven a leer en ese turno. Un precio cambiado exige nuevo resumen; cambios de ciudad invalidan el destino anterior. Se reserva durablemente el cierre para reducir duplicaciones ante una interrupción. Después de cerrar se guarda `PAUSED_CONFIRMED`.

Negociaciones reúnen productos, variantes y cantidades antes de pausar silenciosamente. Reclamos reales pausan sin respuesta; una pregunta hipotética general de garantía sigue atendida como consulta comercial.

## F. Lectura de stock/precios

Se leen `PAGINA DE STOCK!A2:G2` y `A3:G` con `UNFORMATTED_VALUE`, conservando fórmulas evaluadas del catálogo existente. A:F son ID, producto, capacidad, color, stock y precio; G es información. No se utilizan H:I ni precios de publicidad o del código.

Se rechazan cabeceras incompatibles, ID duplicado, filas inválidas, cantidades/precios inválidos y fichas vacías. Solo se ofrecen SKU con stock mayor que cero. Cantidad solicitada superior al stock o almacenamiento explícito contradictorio con capacidad producen pausa. RAM/procesador/sistema se toman de la ficha, cuando existen; no se completan características de otra variante.

No se muestran cantidades de stock; la ficha termina con `🔥 ÚLTIMA UNIDAD DISPONIBLE` únicamente si ese SKU tiene stock 1. Precio ≤100 usa microSD externa de 128 GB; precio >100, 256 GB. Factura agrega 15% según la política recibida. No se aplicó criterio tributario externo ni se modificó la política del usuario.

## G. Multimedia

Se descubren carpetas y archivos reales mediante el módulo existente. Por presentación se usa la primera foto y el primer video en orden numérico, de la carpeta del SKU exacto. Secuencia: **foto → video → ficha → Audio Comercial 1**. El índice de presentación se persiste; un fallo incierto de envío pausa para revisión. Otro SKU inicia su propia presentación y vuelve a usar Comercial 1.

El manifiesto registra todos los archivos, incluidos los que no se envían en la presentación inicial. No se alteró ningún original ni se renombró ningún SKU. Un pedido genérico de foto/video ya presentado remite al mensaje enviado. Un detalle específico solo se reconoce como visible si está aprobado en `PRODUCT_VIDEO_FACTS_JSON`; de otro modo pausa. No se supone que un video genérico demuestre RAM/almacenamiento.

Los tres SKU presentes son `IPADAIR1-32-PLA`, `IPADAIR2-16-PLA`, `CHROMEBOOK-DELL1`. Las imágenes existentes son inferiores a 5 MB y los videos inferiores a 16 MB. Faltan recursos para cualquier otro SKU; se pausa antes de una presentación incompleta cuando falta foto/video.

## H. Agencias

Se reutiliza el parser de 14 columnas del HTML local, normalización de acentos, desambiguación por provincia y selección por número/nombre/dirección. Si ya hay ciudad no se solicita otra vez; provincia solo cuando es necesaria para resolver la ciudad. No se inventan ni recortan agencias.

Hasta 15 agencias se generan PNG completos con la fuente incluida. Más de 15 se genera PDF A4 con todas las agencias, orden/numeración global y páginas. Guayaquil: **94 agencias, 14 páginas**. Se verificaron estructura PDF con Poppler, las páginas renderizadas, una vista de todas las páginas y primera/última página del resultado final. La salida usa información comercial del HTML; no incluye los campos internos de supervisión/email.

Después de la presentación y solicitud de selección se usa Comercial 2. La falta actual de ese audio pausa en esa etapa. Guayaquil permite delivery únicamente si existe una lista aprobada de malls; fuera de Guayaquil se utiliza agencia. Delivery respeta lunes a viernes 10:00–18:00; fines de semana/después del horario propone el siguiente día disponible. No se promete entrega inmediata si no hay tiempo suficiente para coordinar.

## I. Audios

El descubrimiento recorre `resources/Audios`, ignora `.DS_Store`, carpetas ocultas, `__MACOSX` y symlinks, y mapea nombres descriptivos a intenciones. Distingue Windows ≤100 y >100 sin confundir el símbolo del precio. Una asignación ambigua se informa/pausa; formatos sin soporte directo se diagnostican.

Primera consulta con audio oficial: audio. Repetición o `prefersText`: transcripción `.txt` contigua al audio, conservada como contenido oficial. Una transcripción inexistente no se reconstruye con IA: pausa. Las políticas textuales explícitas de la solicitud permiten responder consultas generales cuando falta su audio, sin afirmar que el texto es una transcripción. Los comerciales 1/2 **no tienen sustituto fabricado**: su ausencia impide continuar y produce pausa.

Se conserva transcripción YCloud limitada a medios autenticados, tamaño/duración, eliminación de temporales y modelo configurado. Audios entrantes pueden aportar datos y confirmaciones semánticas. El audio Meta se pausa para revisión en V3; sus rutas/número no se migraron.

## J. /liberar y /borrar

Se autorizan exclusivamente comparando el teléfono con `ASESOR_WHATSAPP`. Son los únicos comandos del runtime nuevo. Se admite mayúscula/minúscula, espacios, móvil local `09…`, `593…`, `+593…` y `00593…`; se persiste `+593…`.

`/liberar` activa y conserva producto, datos, preferencia de texto, audios y contexto. El siguiente mensaje se interpreta con esa memoria. Chats históricos se conservan como `legacyContext` y se mantienen inicialmente pausados para revisión, sin reactivar logística antigua; una liberación explícita permite revalidar catálogo y seguir el flujo V3.

`/borrar` escribe una conversación vacía activa, limpia columnas de fragmentos previos y pendientes comerciales/fallidos del inbox. Si hay alias duplicados de memoria, el reset explícito limpia las filas adicionales; una lectura normal no elige una memoria arbitrariamente. Los IDs técnicos de deduplicación de ingreso siguen como metadatos de seguridad durante su ventana, sin contexto de venta.

## K. Purga de 30 días

La antigüedad se mide por `lastInteraction`, con compatibilidad para timestamps existentes y la columna C. Los mensajes recibidos durante una pausa no prolongan la memoria comercial. Al cumplir 30 días se reemplaza la memoria por un estado vacío/activo, y el mantenimiento descarta sus pendientes de ingreso. Se ejecuta al arranque, cada hora y mediante comprobación al leer una conversación caducada. `/liberar`/`/borrar` actualizan su timestamp.

La memoria habitual mantiene A:C. Si JSON supera 30.000 caracteres, B guarda un descriptor y el contenido se fragmenta en D:…; se respeta el límite de celda de Sheets y se borran restos al reducir/resetear. No se borran filas completas de la hoja ni se modifican fórmulas comerciales.

## L. Pruebas nuevas

**71 pruebas V3**, incluyendo subtests HTTP: 64 en `test-sales.js` y 7 en `test-sales-webhook.js`. Cubren saludo; iPad/Windows/MacBook; mayor stock/empates/requisitos; SKU exacto; última unidad; orden multimedia; audio/repetición/texto; ciudad; imagen/PDF; Guayaquil/delivery/agencia/fuera de Guayaquil; extracción mixta; aceptación/ambigüedad/negación/corrección; cambios de precio; cortes lunes–viernes/sábado/domingo; reserva; descuentos/mayorista/condiciones especiales; multimedia específica; fuentes contradictorias; reclamos y preguntas hipotéticas; pausa; ambos comandos/autorización; purga; comandos viejos; catálogo de Sheets; ausencia de escrituras logísticas; teléfonos; fallos inciertos; recursos faltantes; memoria grande/alias duplicados; firmas y deduplicación del servidor activo.

Las tres familias se prueban con catálogo/multimedia/audio sintéticos. **Los fixtures no sustituyen los recursos oficiales faltantes**. La semántica se simula con resultados de interpretación, y el transporte HTTP se prueba con firmas reales de fixtures; no se midió la precisión de OpenAI con clientes reales ni la reproducción WhatsApp de audios/videos oficiales.

## M. Resultado de npm test

Node **v24.21.0**, npm **11.19.0**. Última ejecución: **671 pruebas, 670 aprobadas, 0 fallidas, 1 omitida**, exit 0.

`npm run test:sales`, ejecutado también sobre la revisión final del servidor: **71/71 aprobadas**, cero fallos/omisiones.

La única omitida es `OS: cwd aislado, lectura/escritura fuera bloqueadas y escritura local permitida`, perteneciente a la herramienta de desarrollo `test-ai-sandbox.js`: su comprobación de aislamiento del SO no aplica en este entorno. No es una prueba comercial.

Antes de editar, `npm test` dentro del sandbox mostró 589 pruebas: 587 aprobadas, una omitida y un fallo `listen EPERM` en el test de webhook. La ejecución posterior con permiso para puertos locales hizo pasar las pruebas HTTP; no se ocultó ni eliminó ese test. El total aumenta porque ahora también se ejecutan los subtests HTTP que antes no llegaron a correr y las pruebas V3.

## N. Suites existentes V2/V2.5

- `npm run test:v2`: **386/386 aprobadas**, cero fallos/omisiones.
- `npm run test:v25`: **163/163 aprobadas**, cero fallos/omisiones.

Estas suites comprueban el runtime archivado y módulos históricos/shared. No demuestran que V3 mantenga GUIA, RESPONDER o postventa: se preservaron expresamente como regresión histórica. Sus assertions no se borraron ni se reescribieron para ocultar comportamientos retirados. La suite del servidor activo es `test-sales-webhook.js`.

## O. Lint/check

`npm run check`: aprobado, **31 archivos** de runtime con sintaxis válida. `git diff --check`: aprobado. No existe script de lint en el proyecto. Prettier se utilizó desde caché temporal, sin añadir dependencias al repositorio ni cambiar `package-lock.json`. Auditoría de recursos: sin HTML inválido y con diagnóstico explícito de ausencia de audios.

## P. Riesgos, diferencias y pendientes reales

1. **Bloqueante: audios ausentes.** No hay archivos oficiales para inspeccionar/transcribir. Sin Comercial 1/2 no puede completarse una venta real. Añadir los originales y transcripciones verificadas; no se generaron audios con contenido inventado.
2. **Bloqueante por SKU: multimedia incompleta.** Solo tres SKU tienen recursos. No existe MacBook ni una base completa Windows. Los tests de esas familias son sintéticos; agregar recursos exactos antes de probarlos realmente.
3. **Bloqueante delivery: malls sin fuente.** No hay lista aprobada en el código/recursos auditados; `DELIVERY_MALLS_JSON=[]` pausa. No se adivinaron malls ni tiempos de traslado.
4. **Políticas MacBook incompletas.** No se encontró una política oficial de año/sistema fuera de stock. Año MacBook no configurado pausa; sistema solo se responde si consta en ficha. No se inventó un año ni un sistema.
5. **Ruta/alias de Ecuador.** Se encontró la ruta anidada y ningún alias/manifiesto previo. El nuevo runtime admite ambas ubicaciones de Ecuador o `AGENCIES_ROOT`; usa el parser/normalización existentes, sin crear alias oficiales inexistentes.
6. **Precio inicial iPad.** Se usa el mínimo real de Sheets en vez de asumir $99,99 si cambia. Esto sigue la prioridad de la fuente de verdad indicada. La política de IVA 15% se implementa literalmente como pidió el usuario.
7. **Catálogo real no auditado por red.** Se validó el contrato A:G mediante fixtures y código existente. No se consultó la hoja productiva ni se comprobó qué SKU/stock/precios tiene hoy. Una inconsistencia detectada produce pausa, no un precio de respaldo.
8. **Contenido exacto de videos sin ficha.** No se afirma que incluyan un detalle pedido salvo que exista una descripción aprobada en `PRODUCT_VIDEO_FACTS_JSON`. No se hicieron pruebas de reproducción por WhatsApp ni una inspección audiovisual completa de los MP4. Tamaño/ubicación/formato de archivo se auditaron; codecs/reproducción quedan para la prueba real.
9. **Una instancia.** Los locks, la asignación de filas y el mantenimiento requieren mantener una sola instancia de este servicio, como la arquitectura anterior. No hay reserva/decremento de inventario al confirmar; disponibilidad puede cambiar entre snapshot y gestión humana.
10. **Entrega incierta.** No existe transacción atómica entre Sheets y WhatsApp. Si hay un fallo de envío/procesamiento se pausa para revisión, sin reintentar a ciegas el bloque comercial. El humano debe revisar el último mensaje antes de liberar.
11. **Memoria anterior.** Se conserva, pero no se toma una orden vieja como autorización para activar logística. Inicialmente exige revisión/liberación; al continuar se revalida y presenta según V3. Contextos ambiguos por teléfonos duplicados requieren revisión o `/borrar` explícito.
12. **Texto de audios.** La fidelidad solo puede comprobarse cuando se aporten los archivos y sus transcripciones oficiales. No se marca una política escrita como transcripción de un archivo que no existe.
13. **Audio Meta.** Se mantiene la integración de sus webhooks/textos, pero el runtime V3 deja ese audio a revisión humana. YCloud es el proveedor principal de audio de esta versión; no se tocó el número viejo.

El soporte de PDF, IDs multimedia y leído/escribiendo se contrastó con documentación primaria de YCloud: [media upload](https://docs.ycloud.com/reference/whatsapp_media-upload), [guía de mensajes](https://docs.ycloud.com/reference/whatsapp-message-sending-guide) y [SDK oficial](https://github.com/YCloud-Developers/ycloud-sdk-node). Esto valida el contrato de integración; no equivale a haber enviado mensajes reales.

## Q. Pasos exactos para una prueba real por WhatsApp

Estos son pasos para una sesión posterior autorizada; **no se ejecutaron** ni se cambió la configuración productiva.

1. Completar `resources/Audios` con Comercial 1, Comercial 2 y categorías oficiales. Guardar cada transcripción verificada en un `.txt` contiguo. Confirmar asignaciones sin ambigüedad ejecutando `npm run audit:resources`.
2. Elegir un SKU con foto/video real. Para empezar, uno de los dos iPad presentes, siempre que coincida con el catálogo de prueba. Añadir multimedia MacBook/Windows de los demás SKU antes de probar esas ramas.
3. Preparar una copia de Sheets para pruebas: `PAGINA DE STOCK` con cabeceras A2:G2, filas desde A3 y fichas exactas; `MEMORIA` con cabeceras en fila 1 y conversaciones desde fila 2. Usar un libro de memoria dedicado. Permitir que se cree `ENTRADAS_V2` en ese libro de pruebas. No usar ni migrar las tablas productivas.
4. Usar un número YCloud separado y autorizado para pruebas, que no sea el número viejo de Meta ni el remitente productivo. Definir el número personal de administrador y otro número personal de cliente.
5. Preparar un archivo de entorno local **fuera de Git**, por ejemplo `/tmp/level-up-v3-test.env`, con credenciales de prueba, IDs de las hojas de prueba, `YCLOUD_PHONE_NUMBER` del número de prueba, `ASESOR_WHATSAPP`, `MODEL_LOW`, `MODEL_TRANSCRIPTION`, secreto de firma y `TEST_MODE=false`. Para delivery, agregar nombres aprobados en `DELIVERY_MALLS_JSON`. No imprimir el archivo ni sus secretos.
6. En Node 20.6 o superior, arrancar localmente con `node --env-file=/tmp/level-up-v3-test.env server.js`. En este entorno Node 24 soporta ese comando. Comprobar `/health` en el puerto elegido.
7. Exponer ese servidor local mediante un endpoint HTTPS temporal de pruebas; configurar **únicamente el webhook del número/cuenta YCloud de prueba** hacia `https://<endpoint-pruebas>/ycloud/webhook`, con el mismo secreto. No cambiar la URL de producción ni configurar el número viejo de Meta. Confirmar firma válida/200; nunca desactivar la firma.
8. Desde el teléfono de administrador enviar `/borrar <teléfono-cliente>`. Desde el cliente enviar `Hola`, consultar iPad/modelo y escoger el SKU/variante. Verificar físicamente **foto → video → características → Comercial 1**, precio real y variante correcta. Confirmar reproducción y legibilidad.
9. Dar ciudad fuera de Guayaquil. Verificar PNG si hasta 15 agencias y PDF completo si más de 15, pregunta de selección y Comercial 2. Escoger una agencia real por número/nombre.
10. Enviar nombre y cédula juntos. Verificar que el resumen incluye WhatsApp canónico, ciudad/provincia, destino, SKU/variante, cantidad, unitario y total. Corregir con `Sí, pero mi cédula termina en 8`; debe actualizar y pedir confirmación de nuevo, sin cerrar.
11. Confirmar con lenguaje natural o audio/emoji claro. Verificar `PAUSED_CONFIRMED` en la memoria de prueba. Mandar varios mensajes y un audio después: no debe responder ni transcribir. Comparar stock y registro de ventas antes/después: no debe haber escritura del bot.
12. Probar `/liberar` y consulta auxiliar, verificando conservación del contexto. Probar `/borrar`, verificando inicio limpio, preferencia/audios reiniciados y ausencia de pendientes antiguos.
13. Repetir garantía dos veces: primero audio, luego texto oficial. Probar `no puedo escuchar`: debe conservar la preferencia y usar transcripciones. Probar reserva completa: $20/14 días/no reembolsable, sin cuentas bancarias, y pausa al confirmar.
14. Probar `quiero precio mayorista para 3 unidades`: debe recopilar SKU/variantes/cantidades antes de pausar, sin prometer contacto. Probar un reclamo de compra anterior después de liberar: pausa inmediata sin respuesta.
15. Probar Guayaquil contraentrega y delivery con malls aprobados, dentro/fuera del horario y en fin de semana. Fuera de Guayaquil, pedir domicilio: solo agencia. Los cortes de despacho 17:00/11:00/domingo pueden verificarse con las pruebas de reloj; no cambiar la hora productiva.
16. Para comprobar purga, crear **solo en memoria de pruebas** una conversación con `lastInteraction` de hace más de 30 días y ejecutar el mantenimiento/arrancar el servidor; debe quedar vacía/activa. Verificar limpieza de pendientes.
17. Guardar resultados de la sesión sin secretos ni datos personales reales; detener el servidor y retirar el endpoint/webhook de pruebas. La validación no autoriza un deploy posterior: ese sería un paso distinto solicitado por el usuario.
