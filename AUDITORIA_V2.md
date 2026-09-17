# Auditoría V2 — Level Up Store

Fecha: 2026-09-16. Referencia funcional exclusiva: [SPEC.md](SPEC.md).

Se revisaron el servidor, los dos módulos de integración, los scripts de pruebas y herramientas de desarrollo, el manifiesto de dependencias y la documentación operativa. Se inventarió `.ai/` como material de desarrollo/histórico, no como reglas funcionales. No se cargó `.env`, no se inspeccionaron valores de credenciales, no se consultaron servicios reales y no se alteraron pedidos ni stock. No se comprobó el despliegue remoto de Render. Las conclusiones se refieren al checkout local, incluidos archivos no versionados; no garantizan qué versión está en producción.

## A. Arquitectura actual

| Componente | Implementación y evidencia |
| --- | --- |
| Backend | Node.js + Express, `server.js` de 2341 líneas. `package.json` inicia `node server.js`; dependencias OpenAI y googleapis. No hay separación entre dominio comercial, router, persistencia y transporte. |
| Meta | GET `/webhook` verifica token; POST `/webhook` recibe mensajes, envía texto/video y obtiene audios mediante Graph v23.0. `server.js:1183`, `1202`, `1246`. Solo procesa el primer mensaje de la primera entrada/cambio. No verifica firma del POST de Meta. |
| YCloud | POST `/ycloud/webhook`, registrado antes del parser JSON. Verifica firma HMAC, ventana de 5 minutos y límite de 256 KiB. **Además responde “YCloud conectado correctamente” a textos entrantes** mediante `lib/ycloud-client.js`; contradice el comentario y `docs/YCLOUD.md`. No integra memoria, estados ni router comercial. |
| OpenAI | Responses para atención humana, confirmación, retiro, extracción JSON y conversación. Modelo literal `gpt-4o-mini` en todos esos usos. Audio con `gpt-4o-mini-transcribe`. No existe selector LOW/NORMAL/HIGH ni medición de uso en producción. Un turno puede usar clasificador, extractor y generador. |
| Stock | `obtenerStock`, `server.js:394`, lee `'PAGINA DE STOCK'!A2:G100`: código, producto, capacidad, stock, precio, activo e información. Solo conserva stock positivo y activo SI. No lee DATOS, no registra ventas ni descuenta existencias. El catálogo enviado al modelo omite las cantidades. |
| Memoria por número | Map `conversaciones` y JSON en `MEMORIA!A2:C` (número, conversación, fecha). `obtenerConversacion`/`guardarConversacion`, líneas 429/477. Un objeto `pedido` por conversación; no hay historial estructurado de múltiples oportunidades. Caché comercial y persistencia operativa conviven. |
| Estados | `etapa: inicio`, flags `confirmado` y `esperandoConfirmacionPedido`; pedido `confirmado → enviado → disponible_retiro → pagado` o `sin_respuesta`. `retirado` es terminal heredado. No existe la máquina de estados oficial V2. |
| Pedidos | Extracción con esquema JSON de una sola línea; borrador completo, resumen determinístico y aceptación contextual. Guarda MEMORIA antes de anunciar venta; ID `PED-` + UUID. APRENDIZAJE guarda historial anonimizado pendiente de aprobación. `server.js:863`, `918`, `1032`, `1175`. |
| Administración | Número desde `ASESOR_WHATSAPP`, normalizado. Comandos GUIA, LLEGO, PAGO y RETIRADO. Exclusión por cliente destino dentro de una instancia; no existen TOMAR, LIBERAR ni DERIVAR. |
| Scheduler | Revisión inicial y cada 60 segundos desde `server.js:781`. Lee Sheets y reconstruye retiros; reservas y reintentos duraderos para llegada y alertas. Repite cada 2 horas, desde 09:00, vence en 72 horas corridas. Zona America/Guayaquil. No existe seguimiento comercial. |
| Audio/multimedia | Descarga audio completo a archivo temporal y transcribe; elimina temporal en finally. No controla duración ni tamaño descargado. Imágenes/documentos no se interpretan; una imagen durante retiro provoca una pregunta. Video comercial solo para iPad Air 1, con media ID en entorno y marca persistida. |
| Render/configuración | `PORT` por entorno y `npm start`; dependencias configuradas con variables. Valida nombres de variables faltantes, pero el servidor escucha aun con configuración incompleta. No se encontró manifiesto Render ni evidencia local suficiente para comprobar réplicas, disponibilidad o configuración remota. |
| Desarrollo IA | `scripts/ai-orchestrator.js` llama xAI/Grok solamente desde CLI, con archivos de contexto explícitos y reportes. Antigravity tiene ruta manual y módulo de aislamiento; no forma parte del flujo cliente. `.ai/` contiene tareas, mapas e informes históricos. No se ejecutaron workers reales. |

Variables utilizadas, sin valores: `OPENAI_API_KEY`, `PHONE_NUMBER_ID`, `WHATSAPP_TOKEN`, `VERIFY_TOKEN`, `ASESOR_WHATSAPP`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `STOCK_SPREADSHEET_ID`, `MEMORIA_SPREADSHEET_ID`, `PORT`, `IPAD_AIR_1_VIDEO_MEDIA_ID`; YCloud usa `YCLOUD_WEBHOOK_SECRET`, `YCLOUD_API_KEY`, `YCLOUD_PHONE_NUMBER`. Las variables Grok/Antigravity corresponden a herramientas de desarrollo. `.gitignore` excluye archivos de entorno y patrones de credenciales; esto no certifica ausencia de secretos en el historial Git.

## B. Qué ya existe

- Backend Express y canal Meta operativo en código; autenticación de servicios por variables, sin número administrativo literal en el flujo de producción revisado.
- OpenAI como proveedor de respuestas de IA al cliente; Grok separado en desarrollo.
- Lectura de catálogo y memoria persistida por número en Google Sheets.
- Recopilación estructurada, validación de campos no vacíos, resumen y confirmación explícita; aceptaciones obvias evitan IA para confirmar.
- Persistencia del pedido antes de la notificación; confirmación no reserva ni descuenta stock.
- GUIA/LLEGO y seguimiento de retiro real reconstruible tras reinicio, con bloqueo por cliente en una instancia, protección de estados terminales y reintentos persistidos de algunos avisos.
- Silencio temprano de pedidos terminales antes de transcripción/IA/stock. Imágenes no confirman retiro ni se analizan con Vision.
- Envío Servientrega/contraentrega y asesor para agencia, documentados en mensajes y prompt; no se observó implementación de delivery local.
- APRENDIZAJE con anonimización y comprobación de ID existente, y suites con servicios y reloj simulados.

## C. Qué existe pero está incompleto o contradice SPEC

| Regla V2 | Brecha actual |
| --- | --- |
| Estados oficiales/cierre | `pagado` y `sin_respuesta` no son estados oficiales V2. El cierre actual silencia también reclamos y nuevas compras; falta distinguir pedido previo, oportunidad y toma humana. |
| Postventa | Pedir asesor produce una explicación comercial; no congela, no deriva ni alerta. En terminales todo se ignora antes de analizar postventa. |
| Confirmación/datos | Teléfono se extrae y solicita al cliente; el fallback a WhatsApp llega después de exigir teléfono completo. No impone el más reciente determinísticamente. Nombre/cédula solo se validan como strings no vacíos. |
| Precio/stock | Se confía en el historial extraído por IA para precio/producto. No hay reconciliación determinística de borrador con SKU, cantidad disponible o total. Excluir agotados del catálogo impide distinguir agotamiento de producto inexistente y elimina señales de escasez. |
| Pedidos | Una línea con variante genérica, sin color/capacidad separados, IDs LU ni múltiples líneas. No hay edición fiable del pedido confirmado antes de GUIA ni barrera de cambios posteriores a humano. |
| GUIA | Guarda guía/estado y avisa, sin validar/descontar stock, registrar venta, congelar ni activar takeover. Permite sustituir guía de un enviado. Si falla el aviso tras persistir guía, repetir la misma GUIA puede omitir el aviso perdido. |
| LLEGO/retiro | Usa 2 h, 09:00 y 72 h corridas; V2 exige 4 h, 08:00 y 3 días laborales. Franjas ambiguas sí reprograman en V1. Retiro no manda agradecimiento final y la alerta pagado no incluye todos los campos V2 (teléfono/precio). |
| Duplicados/concurrencia | Caché message_id de 24 h solo RAM; se pierde al reiniciar. Bloqueos solo dentro del proceso, no entre réplicas. No hay agrupación de 5 segundos. |
| Ecos | Ignora eventos Meta sin `messages`, pero no hay protección explícita general contra mensajes propios ni equivalente funcional compartido con YCloud. |
| Audio | Funciona la transcripción, falta límite de 180 segundos previo al gasto y control del tamaño de descarga. |
| Video | Solo iPad Air 1; fallo permite continuar la ficha. No existe hoja MULTIMEDIA ni cobertura general de productos/variantes. |
| Logs | Algunos errores omiten PII, pero `server.js:1260` imprime `JSON.stringify(message)` completo. No existe evento uniforme con transición, regla, llamadas, tokens y costo por conversación/pedido. |
| Documentación/pruebas | README describe reglas V1 y docs YCloud niega envíos que el código sí hace. Fixture YCloud omite `type: text`, por lo que no cubre la rama de envío; su mock fetch no intercepta necesariamente el cliente importado fuera de la VM. |

## D. Qué falta completamente

1. Router V2 con prioridad explícita, postventa primero frente a compra mixta, negaciones, nueva oportunidad y políticas de silencio para empleo/proveedores/alianzas/insultos.
2. NO_CONTACTAR y no_interesado con cancelación y reactivación controlada; controles human_takeover y comandos TOMAR/LIBERAR/DERIVAR, cierre derivado y modo logístico tras LIBERAR.
3. Límite determinístico de total > $300 con congelamiento y aviso; aceptación de $300 exactos.
4. Operación de venta/stock en GUIA: validar todas las líneas antes de modificar alguna, sin parcialidad ni negativos, con recuperación e idempotencia.
5. Seguimientos comerciales 48/96 h, mensajes fijos, cancelación por confirmación y persistencia de last_customer_message_at, next_followup_at y followup_stage.
6. Rate limit de 20 mensajes/minuto por número y agrupación de 5 segundos.
7. Retención automática de cédula y leads abandonados a 30 días.
8. TEST_MODE como barrera global de efectos reales; las pruebas actuales usan mocks, no una protección del runtime.
9. Configuración de niveles LOW/NORMAL/HIGH desde entorno y métricas de tokens/costo en producción.
10. Estructura operativa MULTIMEDIA con PRODUCTO | CAPACIDAD | COLOR | TIPO | URL; se documenta en SPEC, no se creó una hoja real.

Los nombres V2 de persistencia de retiro no están implementados, pero sus equivalentes parciales sí existen: fechaLlegada, proximaVerificacionRetiro y el plazo calculado. No debe confundirse esa diferencia de esquema con ausencia de scheduler.

## E. Riesgos de modificarlo

- **Privacidad actual comprobada:** el log del payload contiene número/texto y puede contener cédula u otros datos del cliente. Una prueba ya falla por ello; no es solo un riesgo hipotético.
- **Control de acceso Meta:** validar `from` contra el administrador sin autenticar el POST no acredita el origen del remitente. GET VERIFY_TOKEN solo protege la verificación inicial. Añadir validación de firma al adaptar la entrada, sin imprimir credenciales.
- **Ruta paralela YCloud:** puede enviar fuera de cualquier cierre/toma humana. Aplicar controles solo en Meta deja una vía de respuesta adicional; documentación y pruebas ocultan actualmente esa rama.
- **Pérdida de estado:** reemplazar el JSON o renombrar terminales sin migración puede reabrir ventas o repetir avisos. Una nueva compra no debe sobrescribir el pedido previo. JSON inválido puede caer en conversación nueva; requiere tratamiento explícito.
- **Stock compartido:** bloquear por teléfono no evita dos pedidos de clientes distintos sobre el mismo SKU. Sheets no ofrece aquí comparación y escritura atómica entre procesos; se necesita coordinación de inventario y registro de operación recuperable, además de validar todas las líneas. No prometer transacción conjunta entre Sheets y WhatsApp.
- **Fallos parciales:** hay ventanas entre persistir, notificar y registrar APRENDIZAJE; algunas alertas reintentan, otras no. Cualquier nueva GUIA debe poder recuperarse sin descontar dos veces ni dejar stock parcialmente cambiado.
- **Scheduler:** cambiar 72 h a días laborales modifica pedidos en marcha. Se necesita política de migración explícita para no vencer/reabrir pedidos por accidente. Render apagado no ejecuta eventos exactos; la precisión real incluye ticks y latencia.
- **Pruebas acopladas:** varias cargan server.js con VM y nombres de funciones internos. Un refactor amplio rompería el arnés, además del negocio. Mantener pruebas V1 aplicables y documentar las incompatibilidades normativas antes de reemplazarlas.
- **Retención y tamaño:** borrar solo datosCliente.cedula deja posibles copias en borrador/historial/logs. El historial completo crece y se envía a IA; impacta tamaño de celda, cuotas y costo.
- **Despliegue y mensajes programados:** falta verificar configuración real de Render y mecanismo autorizado de mensajes fuera de la ventana de atención del proveedor antes de activar seguimientos comerciales. No se validaron permisos ni plantillas reales en esta auditoría.
- **Trabajo local previo:** ya había `.ai/`, AGENTS.md, main y scripts de orquestación no versionados. No se sobrescribieron. AGENTS.md contiene únicamente `main`; el archivo main está vacío.

## F. Archivos que habrá que tocar

| Archivo | Cambio posterior propuesto |
| --- | --- |
| `server.js` | Insertar router y políticas antes de IA; adaptar estados/memoria, validación de pedidos, stock GUIA y scheduler por bloques. Eliminar log de payload en un cambio específico. |
| `lib/ycloud-webhook.js`, `lib/ycloud-client.js` | Alinear los envíos con las mismas barreras de control/TEST_MODE; resolver respuesta de conectividad y probar textos reales sintéticos. |
| `scripts/test-v1.js`, `scripts/test-venta-real.js`, `scripts/test-ciclo-administrativo.js`, `scripts/test-ycloud-webhook.js` | Mantener regresiones aplicables, cubrir los cambios aprobados V2 y efectos externos aislados. |
| `package.json` | Comandos de validación y suite V2 completa. |
| `.env.example` | Documentar nuevas variables sin valores reales; no modificar `.env`. |
| `README.md`, `docs/YCLOUD.md` | Documentación técnica coherente; remitir reglas funcionales a SPEC. |
| `scripts/ai-orchestrator.js`, `.ai/CURRENT_STATE.md`, `.ai/ARCHITECTURE.md` | Referenciar SPEC en contexto de futuras tareas; no permitir que mapas antiguos definan reglas. No hace falta tocar workers para el router cliente. |
| Nuevos módulos pequeños en `lib/` | Propuesta: estados/políticas, router determinístico, adaptadores de efectos de prueba. Inventario y scheduler comercial se agregarían en bloques siguientes. Nombres definitivos son una decisión de implementación. |
| `SPEC.md` | Solo cambios funcionales expresamente instruidos; resolver puntos pendientes antes de implementar sus ramas. |

## G. Propuesta concreta para BLOQUE DÍA 1 — no implementada

Objetivo propuesto: establecer control de conversación y una barrera de pruebas antes de cambiar inventario o calendarios. El pedido y el scheduler V1 se conservan mientras se integra la entrada V2. El propietario no definió un contenido previo de Día 1; este es el bloque que propone la auditoría.

1. **Base verificable:** corregir el log de payload y la cobertura YCloud; añadir TEST_MODE a todos los envíos y escrituras, incluidas APRENDIZAJE y scheduler. Dobles de red y almacenamiento sintéticos que fallen si se intenta un efecto real.
2. **Estado compatible:** añadir versión de esquema, controles persistidos y estado previo comercial/logístico sin borrar el pedido ni reescribir IDs. Preparar migración documentada de terminales V1; no ejecutar migración masiva en Sheets real.
3. **Router determinístico:** aplicar orden SPEC a textos normalizados antes de clasificadores. Cubrir postventa mixta, negaciones, no_interesado, NO_CONTACTAR y saludo cerrado. Guardar nueva oportunidad sin borrar el pedido anterior; resolver primero las ambigüedades de estados relevantes señaladas en SPEC.
4. **Control administrativo:** TOMAR y LIBERAR con autorización por entorno; persistir toma y restaurar logística cuando ya existe guía. Conectar filtros de envío/scheduler al control humano y NO_CONTACTAR. DERIVAR para pedido confirmado con motivo de cierre, cancelación y silencio del pedido. Resolver antes la precedencia LLEGO/toma humana, sin inventarla.
5. **Protección de entrada:** firma Meta, no ecos, procesamiento de todos los mensajes del lote, rate limit 20/minuto y agrupación de 5 segundos con reloj simulado. Persistencia de deduplicación con estado de procesamiento para recuperación; no confirmar recepción duradera antes de guardar lo necesario.
6. **Cierre de bloque:** comprobar regresiones, revisar diferencias y documentar lo implementado contra SPEC. Sin desplegar ni usar stock real en pruebas automáticas.

Aceptación mínima del bloque:

- TOMAR seguido de texto/audio/reinicio produce cero respuestas de bot y cero llamadas IA; LIBERAR con guía conserva logística.
- Reclamo + “quiero otro” deriva a humano y avisa nombre/número/último mensaje; “no quiero comprar otra” no abre oportunidad.
- “Hola”, “gracias”, “ok” o emoji en cerrado no generan IA; compra nueva explícita abre otra oportunidad conservando pedido previo.
- “No me escriban” cancela mensajes iniciados por nosotros; “no estoy interesado” cancela el seguimiento comercial.
- Comando de número no autorizado no muta pedidos. Un webhook no autenticado no puede suplantar al administrador.
- Duplicado, lote, eco, mensaje 21 del minuto y agrupación se validan con efectos contados; cada caso prueba el resultado observable.
- TEST_MODE bloquea cualquier envío a números reales y cualquier escritura en Sheets real por ambas rutas.

Fuera de este Día 1 propuesto: descontar stock/registrar ventas, IDs LU y pedidos multilínea, calendario de retiro V2 y seguimiento comercial 48/96, selector de modelos, multimedia general y limpieza de retención. Se planifican después del control de conversación; no se presentan como resueltos por este bloque.

## Verificación realizada y límites

- `node --check server.js`: correcto.
- Suites locales: `node --test scripts/test-v1.js scripts/test-venta-real.js scripts/test-ciclo-administrativo.js scripts/test-ai-orchestrator.js scripts/test-ai-sandbox.js scripts/test-ai-worker-antigravity.js scripts/test-ai-manual.js`.
- Resultado: **202 pruebas, 200 aprobadas, 1 fallida, 1 omitida**. Falla `error WhatsApp al asesor conserva pedido y aprendizaje sin PII en logs`, `scripts/test-venta-real.js:91`, por número sintético visible en DEBUG MENSAJE. La prueba OS de sandbox queda omitida por su configuración opt-in.
- Suite YCloud intentada aparte: no pudo abrir puerto local (`listen EPERM 127.0.0.1`). Es una limitación del entorno de ejecución, no evidencia de fallo funcional del endpoint. Su rama de respuesta se auditó estáticamente.
- No se ejecutó test-integrations ni npm start; no hubo conexión de negocio a Meta/OpenAI/Sheets/YCloud ni pruebas contra stock real.
- Resultado de esta tarea: únicamente SPEC.md y este informe. Los defectos quedan documentados, sin refactors ni implementación del Día 1.
