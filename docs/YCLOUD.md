# YCloud — recepción protegida V2

`POST /ycloud/webhook` verifica firma y entrega mensajes al mismo inbox/router V2 que Meta. Ya no envía “YCloud conectado correctamente”. No existe una respuesta de conectividad que evada estados, toma humana o NO_CONTACTAR.

## Firma y códigos HTTP

Configurar `YCLOUD_WEBHOOK_SECRET` sin incluirlo en código ni logs. Se valida `YCloud-Signature: t=<segundos Unix>,s=<HMAC hexadecimal>` sobre timestamp, punto y cuerpo original, con SHA-256 y comparación de tiempo constante. Ventana local de cinco minutos; un solo timestamp y una o varias firmas.

- 200: evento autenticado aceptado, duplicado o ignorado.
- 400: cuerpo o estructura inválida.
- 401: firma incorrecta/ausente o fuera de ventana.
- 413: cuerpo superior a 256 KiB.
- 415: contenido no JSON o compresión no admitida.
- 503: secreto ausente o no se pudo persistir la recepción.

Eventos: `whatsapp.inbound_message.received` y `whatsapp.message.updated`. Solo los entrantes se entregan al inbox; estados de salida no disparan conversaciones. El cliente normalizado utiliza `wamid` si existe, y en su defecto `id`. Evitar suscripciones duplicadas de proveedores con identificadores diferentes para el mismo mensaje.

## Flujo y salidas

Firma → normalización → protección de eco → deduplicación persistida → límite 20/minuto → buffer 5 segundos → router común → guarda final de salida. La administración no espera el buffer comercial. La llamada al receptor solo confirma aceptación duradera, no entrega de una respuesta.

Texto de clientes YCloud se envía mediante `lib/ycloud-client.js` con `YCLOUD_API_KEY` y `YCLOUD_PHONE_NUMBER`. El adaptador exige una guarda explícita; sin ella rechaza enviar. El servidor vuelve a consultar estado antes del envío. El aviso «NUEVO PEDIDO CONFIRMADO» usa el proveedor del chat que confirma el pedido (YCloud o Meta), persistido junto al aviso. Su destinatario se toma de ASESOR_WHATSAPP. Las demás alertas administrativas conservan su transporte anterior. Ver [IMPLEMENTACION_AVISO_ADMIN.md](../IMPLEMENTACION_AVISO_ADMIN.md).

Imágenes/documentos no se interpretan. Audio YCloud (`audio` y alias `voice`) entra por la misma cola. El enlace `audio.link` se descarga únicamente por HTTPS desde el endpoint de medios de api.ycloud.com, con X-API-Key, sin redirecciones, límite de 16 MiB y timeout de 20 segundos. No se registran enlaces ni bytes.

Se verifica la duración antes de transcribir: Ogg/Opus se mide localmente; otros formatos admitidos requieren `ffprobe` disponible en el servidor. ffprobe no permite protocolos de red. Una duración superior a 180 segundos recibe el mensaje fijo y no llama al modelo. Si no se puede verificar, descargar o transcribir, se solicita texto. No se interpreta la duración declarada como prueba suficiente para aceptar un archivo.

`MODEL_TRANSCRIPTION` selecciona el modelo; la llamada usa español, timeout de 60 segundos y no hace reintentos automáticos del SDK. El texto vuelve al router comercial existente. Las métricas usan el wrapper de modelos existente. El archivo privado temporal se elimina en finally; no se guarda audio en Sheets ni almacenamiento permanente. Una caché acotada de transcripciones en MEMORIA permite reusar un resultado ya persistido si falla trabajo posterior; usa la misma privacidad del contexto conversacional. No se puede evitar una segunda transcripción si el proceso cae después de recibirla y antes de persistirla.

La transcripción Meta se conserva. Videos por YCloud no se implementan en este bloque: se registra el error técnico y continúa la información textual, sin marcar video enviado.

`TEST_MODE=true` bloquea salidas reales de ambos proveedores. No cargar `.env` en pruebas automáticas.

## Persistencia y pruebas

Sheets conserva `ENTRADAS_V2` para inbox/IDs y `MEMORIA` para oportunidades y controles. Los logs del receptor solo incluyen metadatos minimizados y remitente enmascarado; nunca texto, multimedia, firma o credenciales.

Ejecutar `npm run test:ycloud` para HTTP/firma con dependencias simuladas y `npm run test:v2` para guardas, router e inbox. La prueba HTTP necesita puerto localhost. Ejecutar `npm test` para toda la suite automática.

Render usa el servidor y PORT existentes. Este cambio no despliega ni configura servicios remotos. Ver [SPEC.md](../SPEC.md) e [IMPLEMENTACION_DIA1.md](../IMPLEMENTACION_DIA1.md) para alcance y límites actuales.
