# Aviso administrativo por canal de origen — 2026-09-18

Se modifica exclusivamente el aviso NUEVO PEDIDO CONFIRMADO. Las otras alertas, la creación del ID, las reglas comerciales, GUIA y LLEGO conservan su implementación. No se desplegó ni se enviaron mensajes reales.

## Canal, destinatario y contenido

Al crear el pedido, crearAvisoConfirmacion captura `conversacion.provider`: ycloud usa enviarMensajeYCloud; meta (o proveedor ausente en el flujo legado) usa el transporte Meta existente. El canal queda guardado para que un cambio posterior del chat no redirija un reintento.

El destinatario se copia de ASESOR_WHATSAPP; no hay números incrustados. Antes de enviar se vuelve a validar contra esa configuración. Si el número configurado cambia, el aviso previo queda pendiente para revisión, sin enviar datos al destino antiguo.

El texto se construye con el pedido y datosCliente persistidos: ID, nombre, teléfono, ubicación, líneas, SKU, capacidades/colores, cantidades, precios, subtotales y total. No depende de los campos de producto único del borrador, que podían omitir información multilínea.

## Persistencia e idempotencia

`MEMORIA!B` conserva el JSON de conversación, incluido `pedido.avisoConfirmacion`. Ese objeto se guarda en la misma escritura que el nuevo pedido confirmado, antes de cualquier llamada de envío. Contiene key `pedido-confirmado:<ID>`, proveedor, destinatario, texto, estado, intentos y fechas. El texto incluye datos personales y permanece únicamente en la memoria privada ya utilizada por el bot, no en logs.

La confirmación existente impide crear un segundo pedido/aviso para el mismo pedido. El procesamiento y la recuperación usan la exclusión por cliente existente (una instancia Node). Antes de enviar se guarda `enviando`; después de aceptación se guarda `enviada`, fecha e identificador del proveedor si fue devuelto. Un aviso enviada nunca se reenvía, incluso tras reinicio. La key es una identidad interna, no una supuesta clave de idempotencia del proveedor.

El recorrido periódico existente recupera avisos pendientes de pedidos actuales y archivados, incluso si el cliente está bajo atención humana: la salida es al asesor, no al cliente. No reconstruye avisos para pedidos históricos que no tengan este objeto, evitando notificaciones retroactivas duplicadas.

## Fallos y límite entre APIs

- Rechazo HTTP 4xx explícito (excepto 408) o configuración YCloud ausente: vuelve a pendiente. Reintentos a partir de 1 minuto con espera exponencial limitada a 1 hora, manteniendo el aviso hasta resolver el problema.
- Timeout, error de red, HTTP 408/5xx o reserva enviando sobreviviente a una caída: estado incierta. No se reenvía automáticamente; requiere comprobar aceptación en el proveedor antes de autorizar otro intento. El aviso completo se conserva; no se elimina.
- Aceptación del proveedor seguida de fallo al guardar enviada: la reserva persistida evita un segundo envío ciego después del reinicio.

No existe una transacción atómica entre Sheets y los proveedores. Por ello no se promete entrega exactamente una vez ante fallos ambiguos ni se asume que todo HTTP 500 permite repetir sin riesgo. Resolver una incierta exige conciliación; no se agregó un comando que la marque enviada o fuerce un envío sin evidencia.

TEST_MODE marca una salida simulada sin invocar transporte real. Los eventos de log incluyen estado técnico/proveedor y errores filtrados, sin número, nombre o texto del aviso.

## Pruebas

Antes: última suite completa verificada, 375 pruebas; 374 aprobadas, 0 fallidas, 1 omitida.
Después: 386 pruebas; 385 aprobadas, 0 fallidas, 1 omitida.

npm test completo, npm run check y git diff --check aprobados. Once pruebas nuevas cubren ambos proveedores, ASESOR_WHATSAPP configurable, contenido multilínea, deduplicación/concurrencia, reintentos 429 de ambos canales, reinicio, TEST_MODE, pérdida de persistencia después de aceptación, caída antes de envío y pedidos históricos.

Se actualizaron las expectativas de pruebas previas: el aviso YCloud ya no usa Meta; el éxito se persiste después del transporte; los fallos ambiguos permanecen registrados.

Archivos de este bloque: server.js, scripts/helpers/v2-runtime.js, scripts/test-admin-notice.js (nuevo), scripts/test-confirmacion-guia.js, scripts/test-venta-real.js, package.json, SPEC.md, docs/YCLOUD.md y este informe. Los cambios de audio anteriores siguen presentes y no se eliminaron.
