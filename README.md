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
