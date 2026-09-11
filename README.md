# level_up_Whatsapp

Bot de WhatsApp de Level Up Store. Recibe el webhook de Meta, consulta stock y
memoria en Google Sheets y usa OpenAI para atención y transcripción de audios.

## Requisitos

- Node.js 18 o superior.
- Variables de entorno configuradas en el proveedor donde se despliegue. Copia
  `.env.example` como referencia, pero no subas un archivo `.env`.

No incluyas credenciales en archivos del repositorio.

## Ejecutar

```bash
npm install
npm run check
npm start
```

Para desarrollo local con Node moderno puedes cargar tu archivo local con:

```bash
node --env-file=.env server.js
```

Para comprobar las integraciones sin enviar mensajes ni modificar Sheets:

```bash
node --env-file=.env scripts/test-integrations.js
```

También está disponible como `npm run test:integrations` cuando las variables
ya están cargadas en el entorno.

## Configuración requerida

| Variable | Servicio | Uso |
| --- | --- | --- |
| `OPENAI_API_KEY` | OpenAI | Respuestas y transcripción de audio. |
| `PHONE_NUMBER_ID` | Meta | Identificador del número de WhatsApp Cloud API. |
| `WHATSAPP_TOKEN` | Meta | Token de acceso para leer medios y enviar mensajes. |
| `VERIFY_TOKEN` | Meta | Valor privado usado al verificar el webhook. |
| `ASESOR_WHATSAPP` | WhatsApp | Número que recibe pedidos y emite comandos administrativos. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google | JSON completo de la cuenta de servicio, en una sola línea. |
| `STOCK_SPREADSHEET_ID` | Google Sheets | Hoja que contiene `PAGINA DE STOCK`. |
| `MEMORIA_SPREADSHEET_ID` | Google Sheets | Hoja que contiene `MEMORIA`. |

`PORT` es opcional y usa `3000` por defecto.

La cuenta de servicio debe tener acceso de lectura y escritura a ambas hojas.
El servidor informa al iniciar los nombres de las variables faltantes o inválidas,
sin mostrar sus valores.

El webhook se expone en `GET /webhook` (verificación de Meta) y `POST /webhook`
(mensajes entrantes).

## Estados del pedido

`confirmado → enviado → disponible_retiro → pagado → retirado`

Comandos que recibe el número asesor:

- `GUIA <id-pedido> <guía>`: registra el envío.
- `LLEGO <guía>`: marca el pedido disponible para retiro y avisa al cliente.
- `PAGO <id-pedido>`: registra el pago.
- `RETIRADO <guía>`: registra retiro y, por ser pago contraentrega, deja el pago confirmado.

Cuando el pedido está disponible para retiro, el cliente también puede escribir
que ya pagó o que ya retiró/recibió su pedido; el bot actualiza la conversación
guardada y avisa al asesor.

APRENDIZAJE se crea automáticamente en el spreadsheet de MEMORIA al guardar
un pedido confirmado, con historial anonimizado y aprobación pendiente (`NO`).
No modifica MEMORIA y evita repetir el mismo ID de pedido dentro de este proceso.

Pruebas locales sin servicios externos: `node --test scripts/test-v1.js`.

## Ajustes V1 para venta real

La solicitud de confirmación queda persistida en MEMORIA como
`esperandoConfirmacionPedido`. Una aceptación posterior confirma una sola vez;
una pregunta o cambio de datos requiere un nuevo resumen. Los webhooks de un
cliente se procesan en orden dentro de una instancia. El cierre guarda MEMORIA,
notifica al asesor y registra APRENDIZAJE. Un error de notificación no revierte
el pedido; los errores se registran sin payloads ni datos personales.

### Video comercial iPad Air 1

Proporciona el **ID numérico de media de WhatsApp Cloud API** de un video real,
previamente cargado y accesible al número de WhatsApp que usa el bot. Configúralo
en `IPAD_AIR_1_VIDEO_MEDIA_ID`. No es un enlace de YouTube/Drive ni un token.
El mismo video sirve para todas las capacidades; se intenta enviar antes de la
ficha y se recuerda el envío en MEMORIA para evitar repetirlo. Sin ID válido o
si Meta falla, continúa la ficha. Este video comercial es independiente de los
videos de prueba y empaque que enviará el asesor para el equipo vendido.

Pruebas adicionales sin servicios externos: `node scripts/test-venta-real.js`.

### Confirmación y entrega del resumen

El servidor recopila un `borradorPedido` estructurado antes de pedir aprobación.
Exige nombre, cédula, teléfono, provincia, ciudad, producto, cantidad positiva
y precio positivo. Con esos datos genera el resumen directamente, lo envía por
WhatsApp y solo después de una respuesta HTTP exitosa persiste el borrador y
`esperandoConfirmacionPedido=true`. No detecta el resumen por frases de la IA.

La aceptación contextual usa ese borrador sin consultar STOCK de nuevo. Las
aceptaciones obvias no llaman a OpenAI; las otras usan el clasificador descrito abajo. Admite las variantes naturales documentadas en las pruebas y
rechaza objeciones o cambios. Una conversación antigua con espera pero sin
borrador completo debe completar/revisar sus datos antes de confirmar.

Todos los envíos usan el mismo helper, que verifica HTTP y conserva el código
de Meta cuando existe, incluso si el cuerpo no es JSON. Un HTTP exitoso indica
aceptación de Meta, no una confirmación de entrega/lectura en el dispositivo.
No hay reintentos persistentes para notificación o APRENDIZAJE: un fallo queda
registrado para seguimiento operativo y no revierte la venta.

### Confirmación semántica V1

Solo con `esperandoConfirmacionPedido=true` se evalúa una nueva aceptación.
Las respuestas claras se resuelven localmente. Las restantes se envían a OpenAI
únicamente para clasificar entre `ACEPTA`, `RECHAZA`, `CORRIGE` y `AMBIGUO`.
Se valida estrictamente la etiqueta: una salida distinta o un fallo se trata
como ambigüedad y solicita aclaración sin crear pedido.

El primer mensaje comercial incorpora un bloque fijo de envío gratuito a todas
las provincias, Servientrega, contraentrega y ambos videos del asesor, antes de
cualquier solicitud de datos. Se marca como enviado solo tras éxito de Meta.
El mensaje posterior a la confirmación también menciona ambos videos antes
del despacho y la posterior gestión con Servientrega, sin prometer horarios.

Las pruebas semánticas usan respuestas simuladas del clasificador; validan el
flujo y sus límites, no la precisión del modelo real.
