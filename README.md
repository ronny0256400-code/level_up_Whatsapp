# Level Up Store WhatsApp V2.5

Backend Node/Express con YCloud como proveedor principal y compatibilidad Meta.
[Contrato funcional](SPEC.md) · [Migración manual de Sheets](docs/MIGRACION-V2.5.md).

La implementación está preparada para revisión local. No desplegar sin resolver
los pasos operativos de la migración y realizar las pruebas con números internos.

## Ejecutar y verificar

Node >=18. Instalar con `npm ci` y ejecutar `npm start` usando la configuración
existente del entorno. No copiar secretos a documentación, tests ni commits.

```sh
npm run check
npm test
npm run test:v2
npm run test:ycloud
git diff --check
```

Estas suites usan mocks, Sheets en memoria y fixtures sintéticos. No realizan
llamadas reales a OpenAI/YCloud/Meta/Sheets. El test de sandbox del sistema puede
omitirse si el sistema operativo no admite la operación aislada. Los tests del
webhook usan puertos locales. No ejecutar `npm run test:integrations` como parte
de la validación aislada: es un diagnóstico de integraciones externas.

`TEST_MODE=true` bloquea transporte y modelos reales y utiliza almacenamiento
en memoria. No es un simulador persistente de producción.

## Flujo y operación

Producto disponible → características/fotos/video/precio/AudioComercial1 →
ciudad/provincia → elección de agencia → nombre/cédula por texto → resumen →
confirmación. Sin límite monetario: persiste LU y CH, confirma y pausa para el asesor.
La venta y el efecto de stock ocurren solo con GUIA; Sheets recalcula stock.

No hay purga por monto. El cierre es texto breve + audio logístico calculado por
fecha/hora de Guayaquil. RESPONDER largo puede usar TTS; cifras/datos críticos
quedan por texto. Ofertas manuales afectan solo SKU/cantidad del pedido actual,
con resumen actualizado, sin alterar fórmulas de precios de Sheets.

Comandos estrictos, solo `ASESOR_WHATSAPP`:

```text
GUIA (CH000001) (NUMERO_GUIA)
LLEGO (NUMERO_GUIA)
RETIRADO (NUMERO_GUIA)
CANCELADO (CH000001)
CANCELADO (NUMERO_GUIA)
LIBERAR (CH000001)
RESPONDER (CH000001): respuesta humana literal
RESPONDER (TELÉFONO_PRECONFIRMACIÓN): respuesta humana literal
TOMAR (CH000001)
TOMAR (TELÉFONO)
DERIVAR (LU0001)
```

CANCELADO usa CH antes de guía y guía después. PAGO fue eliminado. DEVUELTO
es físico/manual en Sheets, nunca automático. GUIA mantiene takeover.
LIBERAR no abre otra compra con pedido activo; tras retiro puede abrirse otra.
LLEGO durante takeover persiste y deja un aviso pendiente para LIBERAR.
Las preguntas difíciles usan espera puntual, independiente de takeover real.

## Recursos locales

```text
resources/agencias/Ecuador/<Provincia>/<Ciudad>/SERVIENTREGA.html
resources/productos/<SKU>/imagen/<SKU>-foto-N.jpg
resources/productos/<SKU>/video/<SKU>-video.mp4
resources/fonts/NotoSans.ttf
resources/fonts/OFL.txt
```

Inventario de importación: **233 HTML, 24 provincias, 233 ciudades, 679 agencias**;
**6 fotos y 3 videos / 3 SKU**. Se copiaron los recursos del propietario; no se
consultaron agencias externas. No se modificaron originales del Desktop.

El parser solo lee tablas locales. Las cards PNG omiten información interna,
usando SVG + resvg y fuente incluida; no requieren Chromium ni red. Con muchos
resultados se pagina y se puede elegir por nombre, sector o dirección. El bot
no selecciona automáticamente entre opciones ambiguas.

Fotos/video solo para SKU actualmente disponible, con orden numérico y ledger
persistente por oportunidad. Falla de una foto no bloquea los otros archivos.

## Configuración

Se mantienen los nombres existentes: OPENAI_API_KEY, MODEL_LOW, MODEL_NORMAL,
MODEL_HIGH, MODEL_TRANSCRIPTION, ASESOR_WHATSAPP, STOCK_SPREADSHEET_ID,
MEMORIA_SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_JSON, credenciales Meta y YCloud.
No cambiaron secretos ni el número de Meta. Webhooks: `/webhook` y
`/ycloud/webhook`; conservar sus firmas y configuración de autenticación.

Nuevos defaults, sin credenciales:

| Variable | Default |
| --- | --- |
| OPENAI_TTS_ENABLED | true |
| OPENAI_TTS_MODEL | gpt-4o-mini-tts |
| OPENAI_TTS_VOICE | cedar |
| OPENAI_TTS_SPEED | 1.15 |
| OPENAI_TTS_FORMAT | wav |
| OPENAI_TTS_DELIVERY_FORMAT | opus |
| OPENAI_TTS_MIN_CHARS | 250 |
| AGENCIES_ROOT | resources/agencias/Ecuador |
| PRODUCT_MEDIA_ROOT | resources/productos |

Audio entrante máximo 180 segundos. TTS comercial usa voz paisa cálida/ágil y
avisa que es generada por IA. Datos, resúmenes, confirmación breve, precios críticos y avisos administrativos
siguen por texto. El bloque logístico posterior a confirmar se envía por TTS.

WAV se convierte a OGG/Opus con ffmpeg cuando está disponible. Si no lo está,
se solicita Opus directamente a OpenAI; fallo de generación permite el mismo
contenido por texto. Un envío con aceptación incierta no se repite ciegamente.
No se guarda audio permanente. El entorno local no tiene ffmpeg/ffprobe; la
reproducción y los codecs de los videos deben verificarse antes del deploy.

Referencias de transporte: [Speech de OpenAI](https://developers.openai.com/api/docs/guides/text-to-speech),
[upload de YCloud](https://docs.ycloud.com/reference/whatsapp_media-upload) y
[tipos de mensajes](https://docs.ycloud.com/reference/whatsapp-messaging-examples).

## Módulos y persistencia

- `server.js`: coordinación, webhook, guardas, memoria y scheduler.
- `v2-policy`, `v2-ingress`, `v2-storage`, `v2-errors`: seguridad, estados,
  dedup/buffer/rate limit, almacenamiento y errores minimizados.
- `v2-inventory`: catálogo evaluado A3:G y escrituras atómicas de ventas.
- `v2-admin-commands`, `v2-chat-id`, `v2-order-transitions`, `v2-calendar`:
  sintaxis, IDs persistentes, cierres centrales y horario/plazos.
- `v2-commercial-flow`, `v2-language`, `v2-agencies`: etapas, interpretación
  acotada y agencias locales.
- `ycloud-client`, `v2-product-media`, `v2-tts`: texto/upload/media, SKU y TTS.
- `v2-outbox`: reserva durable y distinción rechazo/aceptación incierta.
- `v2-sheet-migration`: diagnóstico de fórmulas exclusivamente de lectura.

MEMORIA almacena pedidos y outboxes; ENTRADAS_V2 conserva dedup/pendientes.
No registra venta al confirmar. GUIA escribe B:O/S/V en REGISTRO DE VENTAS;
LLEGO/cancelación F; retiro F/H. P/Q/R/T/U/W permanecen intactas. El backend no
escribe DATOS!P ni RE-STOCK. Los contadores y locks requieren una sola instancia.

Los avisos al asesor usan el proveedor del chat, destino configurado y outbox.
Revisar manualmente estados inciertos antes de habilitar cualquier reintento.
Meta conserva una capa de dedup en RAM además del ingreso durable.

## Herramientas de desarrollo existentes

`npm run ai:work` ejecuta el orquestador de desarrollo de `scripts/ai-orchestrator.js`.
Sus pruebas aisladas siguen dentro de `npm test`. No forman parte del runtime
comercial; no hay Grok ni fallback alternativo para clientes.

La auditoría de dependencias reporta seis avisos moderados heredados (Express,
googleapis y transitivas); no se aplicaron actualizaciones mayores automáticas.
Consultar la migración para los demás límites y pruebas reales pendientes.
