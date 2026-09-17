# Mapa Técnico del Proyecto: Level Up WhatsApp

Este documento resume la arquitectura técnica, componentes clave, flujos de trabajo, dependencias y consideraciones operativas del bot de WhatsApp para Level Up Store.

---

## 1. Punto de Entrada de WhatsApp

* **Módulo:** Recepción de Webhooks y Mensajería Meta Cloud API
* **Archivo / Ruta:** [`server.js`](file:///Users/ronaldrodriguez/Documents/GitHub/level_up_Whatsapp/server.js) (Líneas 137–162, 212–327, 1181–1239, 1244–1589)
* **Función Principal:**
  * Expone `GET /webhook` para verificación de token de Meta (`hub.verify_token`).
  * Expone `POST /webhook` para eventos entrantes, protegido por `serializarWebhook()` para encolar secuencialmente mensajes por usuario/remitente.
  * Deduplica mensajes repetidos de Meta con `mensajesProcesados` (TTL de 24h en memoria).
  * Discrimina remitentes: si es el número asesor (`ASESOR_WHATSAPP`), procesa comandos administrativos (`GUIA`, `LLEGO`, `RETIRADO`, `PAGO`); si es cliente, procesa texto, audios o imágenes.
  * Descarga y transcribe notas de voz mediante WhatsApp Media API + OpenAI Whisper (`transcribirAudio`).
  * Envía mensajes de texto y contenido multimedia mediante Graph API v23.0 (`enviarMensajeWhatsApp`, `enviarContenidoWhatsApp`, `enviarVideoProductoSiCorresponde`).
* **Dependencias Importantes:** `express`, Meta WhatsApp Cloud API (Graph API v23.0), OpenAI SDK (`gpt-4o-mini-transcribe`), Node.js `fetch` nativo, `fs`/`os`/`path`.
* **Riesgos o Dudas:**
  * **Estado en memoria RAM:** La deduplicación y las colas de serialización residen en mapas de memoria (`Map`). Si el servidor se reinicia o corre en múltiples instancias/workers, se pierde la deduplicación y el bloqueo por cliente.
  * **Ventana de 24 horas:** El envío de recordatorios directos fuera de la ventana de atención de Meta puede fallar si la cuenta requiere plantillas (templates) preaprobadas.

---

## 2. Integración con Google Sheets

* **Módulo:** Persistencia y Lectura de Datos en Hoja de Cálculo
* **Archivo / Ruta:** [`server.js`](file:///Users/ronaldrodriguez/Documents/GitHub/level_up_Whatsapp/server.js) (Líneas 340–365, 392–425, 427–520, 608–618, 859–902)
* **Función Principal:**
  * Autentica con Google Sheets API v4 mediante cuenta de servicio (`google.auth.GoogleAuth`) configurada vía `GOOGLE_SERVICE_ACCOUNT_JSON`.
  * Consulta inventario en hoja `'PAGINA DE STOCK'!A2:G100` (`obtenerStock`).
  * Lee y escribe conversaciones/pedidos en la hoja `MEMORIA!A2:C` (`obtenerConversacion`, `guardarConversacion`, `leerMemoriaCiclo`).
  * Crea y añade registros de ventas anonimizadas en la hoja `APRENDIZAJE!A:G` (`guardarAprendizaje`).
* **Dependencias Importantes:** `googleapis` (`google.sheets("v4")`, `google.auth.GoogleAuth`).
* **Riesgos o Dudas:**
  * **Límites de cuota (Rate Limits):** Google Sheets API tiene límites de lectura/escritura (típicamente 300 requests/min por proyecto y 60 por usuario). El bot realiza lecturas frecuentes por cada mensaje y un tick periódico cada 60s.
  * **Sin transacciones ACID / Concurrencia:** Si ocurren escrituras simultáneas sobre la misma fila o al calcular filas vacías, podrían sobrescribirse datos. El script implementa `exclusivoV1("asignacion-fila-memoria")`, pero solo aplica a nivel de proceso único.
  * **Tamaño por celda:** Todo el estado de la conversación se almacena serializado como JSON en una única celda (columna B). Si una conversación supera los 50.000 caracteres, Sheets rechazará la actualización.

---

## 3. Sistema de Memoria

* **Módulo:** Memoria de Conversaciones e Historial de Estados
* **Archivo / Ruta:** [`server.js`](file:///Users/ronaldrodriguez/Documents/GitHub/level_up_Whatsapp/server.js) (Líneas 190–199, 427–520, 529–535)
* **Función Principal:**
  * Mantiene una caché rápida en RAM (`conversaciones = new Map()`).
  * Persiste el estado central en Google Sheets (`MEMORIA!A2:C`): Columna A = Teléfono, Columna B = JSON de Conversación, Columna C = Timestamp ISO.
  * `obtenerConversacion(numero, refrescar)`: recupera desde RAM o refresca desde Sheets si se requiere consistencia estricta.
  * `guardarConversacion(numero, conversacion)`: actualiza la fila en Sheets y sincroniza la memoria local.
  * `exclusivoV1(cliente, operacion)`: serializa mutaciones concurrentes por cliente mediante promesas encadenadas.
* **Dependencias Importantes:** Google Sheets v4, Node.js `Map` y `Promise`.
* **Riesgos o Dudas:**
  * Si se edita manualmente la hoja de cálculo, la instancia en ejecución no detecta cambios hasta que se solicite con `refrescar = true`.
  * Si el JSON en columna B se corrompe manualmente, `obtenerConversacion` captura el error silenciosamente y reinicia el estado a una conversación vacía, perdiendo el pedido asociado.

---

## 4. Manejo de Pedidos

* **Módulo:** Extracción de Datos, Confirmación y Ciclo de Vida del Pedido
* **Archivo / Ruta:** [`server.js`](file:///Users/ronaldrodriguez/Documents/GitHub/level_up_Whatsapp/server.js) (Líneas 42–134, 916–1175, 1326–1455, 1565–1589)
* **Función Principal:**
  * `extraerDatosPedido(conversacion)`: utiliza OpenAI con `json_schema` estructurado estricto para extraer nombre, cédula, teléfono, provincia, ciudad, producto, variante, cantidad y precio.
  * `datosPedidoCompletos(datos)`: valida que todos los campos mandatorios estén presentes y sean válidos.
  * `generarResumenPedido(datos)`: genera el texto de resumen de compra con datos de Servientrega y contraentrega antes de pedir confirmación.
  * `clasificarConfirmacion(conversacion, texto)`: evalúa si el cliente confirma (`ACEPTA`), rechaza (`RECHAZA`), corrige (`CORRIGE`) o duda (`AMBIGUO`) usando regex locales o fallback a GPT-4o-mini.
  * `confirmarPedidoSiCorresponde(...)`: crea el pedido con UUID (`PED-XXXX`), estado inicial `confirmado`, persiste en `MEMORIA`, envía notificación de nuevo pedido al asesor (`notificarAsesor`) y registra en `APRENDIZAJE`.
  * Ciclo de estados mediante comandos del asesor:
    * `GUIA <idPedido> <guía>` $\rightarrow$ pasa a `enviado` y avisa al cliente con el número de guía.
    * `LLEGO <guía>` $\rightarrow$ pasa a `disponible_retiro`, registra `fechaLlegada` (ancla de 72h) y envía mensaje de retiro.
    * `PAGO <idPedido>` o `RETIRADO <guía>` $\rightarrow$ pasa a `pagado` y desactiva seguimiento.
* **Dependencias Importantes:** `openai` (`gpt-4o-mini`), Node `crypto` (`randomUUID`), Google Sheets v4, WhatsApp Cloud API.
* **Riesgos o Dudas:**
  * Si la llamada a WhatsApp para notificar al asesor falla, el pedido queda guardado pero el asesor no recibe el aviso push por chat (se requiere revisar la hoja de cálculo o los logs).
  * Los comandos administrativos no envían confirmación de error al asesor si la guía o ID no existen (responden silenciosamente con HTTP 200).

---

## 5. Manejo de Stock

* **Módulo:** Consulta de Catálogo y Control de Disponibilidad
* **Archivo / Ruta:** [`server.js`](file:///Users/ronaldrodriguez/Documents/GitHub/level_up_Whatsapp/server.js) (Líneas 392–425, 1598–1649, 1678–1737, 2078–2244)
* **Función Principal:**
  * `obtenerStock()`: consulta celdas `'PAGINA DE STOCK'!A2:G100`.
  * Filtra ítems activos con `stock > 0` y `activo === "SI"`.
  * Agrupa variantes por nombre de producto y compila el bloque de texto `stockTexto`.
  * Inyecta el catálogo formateado en el prompt de OpenAI bajo una regla estricta de "LISTA CERRADA" (prohibido inventar productos, precios o existencias).
* **Dependencias Importantes:** Google Sheets v4.
* **Riesgos o Dudas:**
  * **Rango estático `A2:G100`:** Si el catálogo supera los 99 ítems, los registros posteriores a la fila 100 se omiten automáticamente.
  * **Sin descuento automático de stock:** Confirmar una compra no descuenta el valor en la columna de stock de Google Sheets. El ajuste debe ser manual; de lo contrario, puede ocurrir sobreventa.
  * **Sobrecarga de lectura:** Se consulta la hoja de stock en cada mensaje entrante del cliente sin caché temporal en memoria.

---

## 6. Seguimiento y Follow-ups

* **Módulo:** Scheduler de Seguimiento de Retiro y Cierres Automáticos
* **Archivo / Ruta:** [`server.js`](file:///Users/ronaldrodriguez/Documents/GitHub/level_up_Whatsapp/server.js) (Líneas 522–607, 664–840, 2329–2332)
* **Función Principal:**
  * `iniciarSchedulerRetiro()`: activa un singleton con `setInterval` cada 60 segundos al iniciar el servidor.
  * `revisarSeguimientos()`: lee periódicamente `MEMORIA!A2:C`, evalúa pedidos en estado `disponible_retiro`:
    * Verifica plazo máximo de 72 horas reales desde `fechaLlegada` (`vencioRetiro`).
    * Si vence, ejecuta `cerrarPedidoCiclo` a estado `sin_respuesta` y alerta al asesor.
    * Reintenta avisos de llegada fallidos (hasta 3 intentos separados por 60s).
    * Gestiona recordatorios automáticos al cliente dentro del horario comercial de Ecuador (`America/Guayaquil`: Lunes–Viernes 09:00–17:00, Sábados 09:00–12:00, Domingos no operativo).
  * `interpretarHorarioRetiro()` y `clasificarRetiroCliente()`: interpreta respuestas del cliente sobre horarios estimados o confirmaciones de retiro/pago.
* **Dependencias Importantes:** Node.js timers (`setInterval`), `Intl.DateTimeFormat` (zona horaria `America/Guayaquil`), Google Sheets v4, Meta WhatsApp API.
* **Riesgos o Dudas:**
  * **Persistencia en entornos Serverless / Spindown:** Si el servidor se aloja en un plan gratuito de Render o contenedor con suspensión por inactividad, el temporizador se detiene mientras no haya tráfico entrante.
  * **Concurrencia entre réplicas:** Si se despliegan 2 o más réplicas del servidor, cada una ejecutará el scheduler independientemente, duplicando recordatorios.

---

## 7. Scripts Importantes

* **Módulo:** Herramientas de Verificación y Diagnóstico
* **Archivo / Ruta:**
  * [`scripts/test-integrations.js`](file:///Users/ronaldrodriguez/Documents/GitHub/level_up_Whatsapp/scripts/test-integrations.js)
  * [`package.json`](file:///Users/ronaldrodriguez/Documents/GitHub/level_up_Whatsapp/package.json) (Scripts npm: `check`, `test:integrations`, `start`)
* **Función Principal:**
  * `test-integrations.js`: ejecuta una comprobación en vivo (modo solo lectura) de las credenciales de OpenAI, Google Sheets y Meta WhatsApp Cloud API sin enviar mensajes ni mutar datos.
  * `npm run check`: verifica la validez de sintaxis JavaScript en `server.js` y `scripts/test-integrations.js` usando `node --check`.
* **Dependencias Importantes:** `openai`, `googleapis`, `node:fetch`.
* **Riesgos o Dudas:**
  * `test-integrations.js` requiere que las variables de entorno reales estén cargadas en el proceso para funcionar.

---

## 8. Tests Existentes

* **Módulo:** Batería de Pruebas Unitarias y de Integración Simulada
* **Archivo / Ruta:**
  * [`scripts/test-v1.js`](file:///Users/ronaldrodriguez/Documents/GitHub/level_up_Whatsapp/scripts/test-v1.js)
  * [`scripts/test-venta-real.js`](file:///Users/ronaldrodriguez/Documents/GitHub/level_up_Whatsapp/scripts/test-venta-real.js)
  * [`scripts/test-ciclo-administrativo.js`](file:///Users/ronaldrodriguez/Documents/GitHub/level_up_Whatsapp/scripts/test-ciclo-administrativo.js)
* **Función Principal:**
  * Emplean el runner nativo de Node.js (`node:test`) y simulan el entorno completo en una sandbox con `node:vm` interceptando llamadas a red, Sheets y OpenAI sin tocar servicios externos:
    * `test-v1.js`: valida comandos `PAGO`, `LLEGO` y la creación/anonimización de la hoja `APRENDIZAJE`.
    * `test-venta-real.js`: valida el flujo conversacional de ventas, confirmación semántica, deduplicación de webhooks, video comercial de iPad Air 1 y tolerancia a fallos.
    * `test-ciclo-administrativo.js`: valida el ciclo completo (`GUIA`, `LLEGO`, `PAGO`, `RETIRADO`), reglas de horario en Guayaquil, vencimiento de 72h, alertas y recuperación tras reinicio.
* **Dependencias Importantes:** `node:test`, `node:assert/strict`, `node:vm`, `node:fs`, `node:path`.
* **Riesgos o Dudas:**
  * No existe un comando `"test"` en `package.json` que ejecute las tres suites en un solo paso (`npm test`).
  * Las pruebas se ejecutan sobre mocks en memoria de Sheets y OpenAI, por lo que no detectan cambios de esquema en vivo de las APIs externas.

---

## 9. Archivos de Configuración Relevantes

* **Módulo:** Configuración de Entorno y Control de Versiones
* **Archivo / Ruta:**
  * [`package.json`](file:///Users/ronaldrodriguez/Documents/GitHub/level_up_Whatsapp/package.json)
  * [`.env.example`](file:///Users/ronaldrodriguez/Documents/GitHub/level_up_Whatsapp/.env.example)
  * [`.gitignore`](file:///Users/ronaldrodriguez/Documents/GitHub/level_up_Whatsapp/.gitignore)
* **Función Principal:**
  * `package.json`: declara las dependencias principales (`express`, `openai`, `googleapis`), versión mínima de Node (`>=18`) y scripts de ejecución.
  * `.env.example`: documenta las variables requeridas:
    * OpenAI: `OPENAI_API_KEY`.
    * Meta WhatsApp: `PHONE_NUMBER_ID`, `WHATSAPP_TOKEN`, `VERIFY_TOKEN`, `ASESOR_WHATSAPP`.
    * Google Sheets: `GOOGLE_SERVICE_ACCOUNT_JSON`, `STOCK_SPREADSHEET_ID`, `MEMORIA_SPREADSHEET_ID`.
    * Opcionales: `PORT`, `IPAD_AIR_1_VIDEO_MEDIA_ID`.
  * `.gitignore`: previene la fuga accidental de archivos de entorno (`.env*`), claves de servicio de Google (`gen-lang-client-*.json`, `*credentials*.json`) y certificados.
* **Dependencias Importantes:** Motor de ejecución Node.js `>=18`.
* **Riesgos o Dudas:**
  * La variable `GOOGLE_SERVICE_ACCOUNT_JSON` debe pasarse como un string JSON en una sola línea; los caracteres de nueva línea en la clave privada (`\n`) pueden ocasionar errores de parseo según el entorno de despliegue.
