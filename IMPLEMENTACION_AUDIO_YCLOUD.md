# Audio YCloud y verificación de pedidos — 2026-09-18

## Causa del fallback

En server.js, la rama de mensajes audio comprobaba provider === ycloud, enviaba «Por favor escribe tu consulta para poder ayudarte» y devolvía HTTP 200 incondicionalmente. Nunca descargaba audio.link ni invocaba MODEL_TRANSCRIPTION. No era un fallo de OpenAI ni de credenciales.

## Implementación

- El receptor firmado normaliza audio y el alias voice antes de la cola. Conserva IDs, proveedor, buffer, deduplicación y controles existentes.
- lib/ycloud-audio.js descarga audio.link únicamente del endpoint HTTPS api.ycloud.com/v2/whatsapp/media/download/<id>, sin puertos alternativos, credenciales en URL ni redirecciones. X-API-Key se envía solo a ese destino. Se limita descarga a 20 segundos y 16 MiB, incluso sin content-length.
- Se verifica duración del archivo; más de 180 segundos nunca llega a transcripción. Ogg/Opus usa el lector local existente. Otros formatos requieren ffprobe en el runtime; si falta o no verifica duración, se solicita texto. No se desplegó ni se verificó la disponibilidad de ffprobe en Render. Los MIME no admitidos reciben fallback.
- El archivo temporal se crea en directorio privado, con permisos 0600; se destruye el stream y se elimina el directorio en finally, tanto en éxito como fallo. No hay almacenamiento de audio permanente. Una terminación abrupta del proceso no ejecuta finally; el archivo reside solo en el temporal local.
- MODEL_TRANSCRIPTION se utiliza a través del wrapper existente, con métricas transcription sin contenido, timeout de 60 segundos y sin reintentos del SDK para este flujo. No se fija un modelo en código.
- La transcripción continúa por el router existente, captura de datos y confirmación. Se conserva en una caché de hasta 20 entradas en MEMORIA, junto al contexto privado, antes del procesamiento posterior. El reintento tras reinicio puede reutilizarla. Una caída antes de persistir ese resultado aún puede repetir la llamada; no se promete exactamente una vez entre APIs.
- TEST_MODE no descarga ni transcribe. Fallos de descarga/transcripción solicitan texto, sin registrar URLs, binarios, mensajes completos ni credenciales. Se mantienen bloqueos de atención humana y no contactar.

Contrato de medios: [ejemplo oficial de audio entrante de YCloud](https://docs.ycloud.com/reference/whatsapp-inbound-message-webhook-examples). El endpoint de transcripción utiliza el SDK OpenAI existente; ver [documentación oficial](https://developers.openai.com/es-419/api/docs/guides/speech-to-text).

## Pedido confirmado: verificación, sin cambiar su implementación

La conversación se guarda en MEMORIA!A:C del documento MEMORIA_SPREADSHEET_ID: A contiene el número, B el JSON y C la fecha. El JSON conserva datosCliente (nombre, cédula, teléfono WhatsApp, provincia y ciudad) y pedido (ID, estado, líneas con SKU/producto/capacidad/color/cantidad/precio/subtotal y total).

GenerarIdPedido usa el contador persistido __V2_COUNTER__ dentro de MEMORIA y examina IDs de pedidos actuales/archivados para evitar reutilizarlos. Produce LU0001, LU0002, etc., bajo exclusión del proceso. Se conserva el límite de una instancia Node; no es un contador transaccional entre réplicas.

El test crea el resumen de IPAD AIR 1, IPADAIR1-32-PLA, 32 GB, plateado, cantidad 1 y precio 110; confirma como cliente YCloud y comprueba todos los campos persistidos. La confirmación conserva existencias 3 y cero filas nuevas de ventas. Después reinicia el runtime y ejecuta GUIA usando el ID persistido: una fila enviada, SKU correcto, cantidad 1 y guía correcta; precio evaluado 110 y existencias 2.

El recálculo de T (precio), U (valor) y stock lo simula el lector de Sheets de la prueba; no lo implementa el backend. Se comprueba que las fórmulas permanecen intactas. No se verificaron fórmulas de una hoja real ni se alteraron sus datos.

## Cómo recibe el administrador el ID y gap encontrado

La notificación existente «NUEVO PEDIDO CONFIRMADO» incluye «🆔 Pedido: LU…» y se envía a ASESOR_WHATSAPP después de persistir el pedido. El administrador puede usar ese ID en GUIA.

Gap: notificarAsesor conserva el transporte Meta incluso para clientes entrantes de YCloud. La entrega depende de que Meta esté configurado y acepte el envío. Si falla, se registra el fallo y el pedido sigue confirmado, pero no existe reintento persistente de ese aviso. El ID permanece en el JSON de MEMORIA; no se agregó una consulta administrativa ni una solución alternativa. La prueba reproduce este fallo y confirma que no se pierde el pedido.

## Validación

Antes: 351 pruebas, 350 aprobadas, 0 fallidas, 1 omitida.
Después: 375 pruebas, 374 aprobadas, 0 fallidas, 1 omitida.

npm test completo, npm run check y git diff --check aprobados. Pruebas con mocks: 21 casos de audio, 2 de confirmación/GUIA y 1 HTTP adicional para normalización audio/voice. Cubren límite exacto y exceso de duración, fallos, SSRF/redirecciones/tamaño, limpieza temporal, métricas, captura, confirmación, buffer, duplicados y reinicios.

Archivos: lib/ycloud-audio.js (nuevo), lib/ycloud-webhook.js, lib/v2-audio.js, lib/v2-models.js, server.js, scripts/helpers/v2-runtime.js, scripts/test-ycloud-audio.js (nuevo), scripts/test-confirmacion-guia.js (nuevo), scripts/test-ycloud-webhook.js, package.json, SPEC.md, docs/YCLOUD.md y este informe.

Sin cambios en LLEGO, reglas comerciales o lógica de GUIA/confirmación. Sin despliegue ni llamadas a servicios reales.
