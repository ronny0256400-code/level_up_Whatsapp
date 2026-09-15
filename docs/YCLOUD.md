# Recepción inicial de YCloud

`POST /ycloud/webhook` solo valida y registra metadatos. No llama a OpenAI,
Sheets ni WhatsApp, no crea pedidos y no envía respuestas a clientes.
`/webhook` de Meta conserva sus handlers y su parser JSON.

## Configuración y firma

Configurar `YCLOUD_WEBHOOK_SECRET` en el entorno del proceso. No es una API key:
debe coincidir con el secreto de firma del endpoint configurado en YCloud.
El módulo no lee archivos de entorno ni muestra el secreto.

Se valida `YCloud-Signature: t=<segundos Unix>,s=<HMAC hexadecimal>` sobre
`timestamp + '.' + cuerpo original`, con SHA-256 y comparación de tiempo
constante, conforme a la [documentación de YCloud](https://docs.ycloud.com/reference/configure-webhooks).
Se aceptan múltiples firmas `s` y un solo `t`. La política local rechaza
timestamps a más de 5 minutos, en el pasado o futuro; mantener el reloj del
servidor sincronizado. El timestamp de firma no es createTime del evento.

| Caso | HTTP |
| --- | --- |
| Evento soportado válido y firmado | 200 |
| Evento desconocido válido y firmado | 200, ignored: true |
| Body vacío, JSON inválido o estructura inválida | 400 |
| Firma ausente, incorrecta o timestamp fuera de ventana | 401 |
| Body superior a 256 KiB | 413 |
| Content-Type no JSON o compresión no admitida | 415 |
| YCLOUD_WEBHOOK_SECRET ausente | 503 |

La firma se comprueba antes de interpretar JSON. En solicitudes con varios
errores se devuelve el primer error detectado. No se confirma con 200 un
evento sin autenticar. YCloud puede reintentar respuestas no 2xx.

Eventos soportados: `whatsapp.inbound_message.received` (objeto
`whatsappInboundMessage`) y `whatsapp.message.updated` (objeto `whatsappMessage`).
Los logs incluyen tipo, id o wamid, remitente enmascarado (solo últimos cuatro
dígitos), fecha de recepción y fecha del evento si es válida. No incluyen texto,
multimedia, nombres, payload completo, headers de autorización ni firma.
No hay persistencia ni deduplicación en esta etapa; un reintento puede producir
otra línea de log.

## Pruebas locales sin credenciales reales ni chatbot

```sh
npm run test:ycloud
```

Para probar con HTTP manualmente, iniciar solo el receptor en una terminal:

```sh
YCLOUD_WEBHOOK_SECRET=local-test node -e 'const express=require("express"); const app=express(); app.post("/ycloud/webhook",require("./lib/ycloud-webhook").createYCloudWebhook()); app.listen(3001,"127.0.0.1");'
```

En otra terminal, enviar un evento ficticio firmado con ese secreto de prueba:

```sh
node <<'NODE'
const { createHmac } = require('node:crypto');
const timestamp = Math.floor(Date.now() / 1000);
const body = JSON.stringify({
  type: 'whatsapp.inbound_message.received',
  createTime: new Date().toISOString(),
  whatsappInboundMessage: { id: 'local-message', from: '+593999123456' }
});
const signature = createHmac('sha256', 'local-test')
  .update(`${timestamp}.${body}`).digest('hex');
fetch('http://127.0.0.1:3001/ycloud/webhook', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'YCloud-Signature': `t=${timestamp},s=${signature}` },
  body
}).then(async response => console.log(response.status, await response.json()));
NODE
```

Resultado esperado: `200 { received: true, ignored: false }`. Estos comandos
no leen .env ni usan credenciales existentes. Detener el receptor con Ctrl+C.

## Render

El endpoint usa el servidor existente y su variable PORT. No requiere nuevas
dependencias ni cambios al comando `npm start`. Antes de recibir tráfico real:

1. Configurar YCLOUD_WEBHOOK_SECRET en las variables de entorno del servicio.
2. Desplegar esta versión.
3. Registrar en YCloud `https://<servicio>.onrender.com/ycloud/webhook` y suscribir
   los dos eventos soportados con firma habilitada.
4. Enviar un evento de prueba desde YCloud y verificar el HTTP y los metadatos.

El código está preparado para Render; no se ha desplegado ni probado contra
YCloud real en esta etapa. La velocidad de entrega también depende de que el
servicio Render esté activo; un servicio suspendido puede requerir reintentos.
