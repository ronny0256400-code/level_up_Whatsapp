# Level Up Store — V2, Día 1 / implementación #1

La única fuente funcional es [SPEC.md](SPEC.md). El alcance y las verificaciones de esta entrega están en [IMPLEMENTACION_DIA1.md](IMPLEMENTACION_DIA1.md). Los apartados V1 de abajo se conservan como historial técnico y no autorizan reglas que contradigan SPEC.

Cambios actuales: router previo a IA, toma humana persistida, postventa sin respuesta al cliente, nuevas oportunidades independientes, deduplicación/buffer/rate limit, firma Meta, salidas YCloud protegidas, pedidos multilínea y límite de $300, métricas privadas y modelos por entorno. PAGO y RETIRADO ya no ejecutan acciones.

Configurar `MODEL_LOW`, `MODEL_NORMAL`, `MODEL_HIGH`, `WHATSAPP_APP_SECRET` y el número real `WHATSAPP_BUSINESS_NUMBER`, además de las variables existentes. `MODEL_TRANSCRIPTION` selecciona el modelo de audio. No hay modelos de Responses predeterminados: una configuración incompleta impide el flujo que los necesita. Consultar `.env.example`, sin subir `.env`.

`TEST_MODE=true` sustituye Sheets y OpenAI por adaptadores de memoria y bloquea los envíos reales, incluidos los avisos administrativos. No cargar credenciales reales para pruebas automáticas. `npm test` ejecuta la suite simulada completa; la prueba HTTP de YCloud requiere poder escuchar en localhost. `npm run test:integrations` es un diagnóstico externo separado y no forma parte de esa suite.

La recepción crea `ENTRADAS_V2` dentro del spreadsheet de memoria para mensajes pendientes/IDs. No escribe stock. Sigue siendo necesario operar con **una sola instancia Node**: los bloqueos entre procesos y las transacciones de inventario corresponden a trabajo posterior.

## Documentación histórica V1

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

`confirmado → enviado → disponible_retiro → pagado`

Si vence el seguimiento sin confirmación: `disponible_retiro → sin_respuesta`.

Comandos que recibe el número asesor:

- `GUIA <id-pedido> <guía>`: registra el envío.
- `LLEGO <guía>`: marca el pedido disponible para retiro y avisa al cliente.
- `PAGO <id-pedido>`: registra el pago.
- `RETIRADO <guía>`: alias de compatibilidad que termina en `pagado`.

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

### Solicitudes de atención humana y pre-registro

Antes de evaluar la confirmación se detecta si el cliente pide atención humana.
Las solicitudes claras se reconocen localmente y las expresiones equivalentes
usan un clasificador semántico de intención. Las aceptaciones obvias conservan
el camino local sin OpenAI. Si el clasificador falla mientras hay un resumen
pendiente, se pide aclaración sin confirmar ni notificar al asesor.

Sin pedido registrado, se explica que primero se ayudará a registrar y aprobar
la compra; luego el asesor seguirá personalmente por el mismo chat. Si ya hay
pedido, se reconoce su registro sin pedir repetirlo. La solicitud por sí sola
no transfiere ni notifica y no cambia la aprobación pendiente. La venta puede
continuar en los siguientes mensajes.

El bloque previo a los datos incluye coordinación de entrega, información de
agencias/puntos disponibles en la zona y los videos de funcionamiento/prueba y
del empaque antes del despacho; conserva envío gratis y contraentrega. El bot
no inventa agencias: indica que el asesor proporcionará esa información.

## Ciclo administrativo final V1

Antes de este cambio existían comandos y campos de horario, pero no había un
scheduler real. El antiguo seguimiento contestaba únicamente cuando llegaba
un mensaje y podía terminar en `retirado`. Ahora los únicos cierres nuevos son
`pagado` y `sin_respuesta`; nunca se cobra por vencimiento.

### Comandos y estados

- `GUIA <idPedido> <guía>` permite `confirmado → enviado`, persiste guía y fecha
  de envío, conserva datos e historial y avisa al cliente. Repetir la misma guía
  no repite el aviso ni reinicia la fecha. No reabre estados terminales.
- `LLEGO <guía>` permite `enviado → disponible_retiro`, conserva la primera
  `fechaLlegada`, reserva el aviso, activa el seguimiento y envía el mensaje de
  llegada con cédula, guía, pedido, pago al retirar y pregunta de día/hora.
  El seguimiento queda persistido antes de intentar el envío para sobrevivir
  una caída. Si falla, el scheduler o un nuevo LLEGO puede reintentarlo después
  de 60 segundos, con máximo 3 intentos persistentes. Un aviso enviado no se repite.
  No se reinicia fechaLlegada; al vencer o pagar ya no se envía aviso de llegada.
- Una confirmación clara de retiro (o pago) en `disponible_retiro` termina en
  `pagado`, registra `fechaPago` y `fechaRetiro`, desactiva seguimiento y reserva
  una única alerta PAGADO. Los textos ambiguos piden aclaración; las imágenes
  solo preguntan si pudo retirar, sin descargar ni usar Vision.
- `PAGO <idPedido>` conserva el contrato administrativo existente: cambia solo
  estado y fechaPago, no envía mensajes y es idempotente. El estado `pagado`
  invalida cualquier próximo recordatorio, aunque queden campos históricos de
  seguimiento. `RETIRADO <guía>` es alias del mismo mecanismo. Una acción manual
  no genera la alerta que informa que *el cliente* confirmó el retiro.
- A las 72 horas desde `fechaLlegada`, un pedido que seguía en retiro, con guía
  y sin fechaPago, se cierra como `sin_respuesta`, sin asignar fechaPago. La alerta
  incluye cliente, teléfono, producto/variante, guía e ID y explica el cierre.
- No se permite reabrir `pagado` o `sin_respuesta` con GUIA/LLEGO, ni convertir
  automáticamente `sin_respuesta` en cobrado. También se rechaza PAGO sobre
  `sin_respuesta` en V1: cualquier revisión posterior queda al equipo humano.
- Los antiguos estados `retirado` se respetan como cierres compatibles; nunca
  se generan nuevos pedidos con ese estado.

### Scheduler real y horario interno

Al escuchar correctamente el puerto del servidor se inicia una revisión y un
intervalo de **60 segundos**, sin timers por cliente. Cada revisión lee las filas
JSON de `MEMORIA!A2:C`, filtra seguimientos activos y procesa pendientes. Sheets
es la fuente de verdad: un reinicio reconstruye el trabajo desde esas filas.
No hay Redis, PostgreSQL, colas externas ni llamadas a OpenAI en el scheduler.

Las mutaciones del scheduler y los webhooks se serializan por cliente/pedido
en una sola instancia. Los comandos administrativos toman el bloqueo del cliente
destino. Los clientes independientes avanzan en paralelo y los ticks omiten
clientes que están ocupados, sin acumular trabajo. El scheduler es singleton:
iniciarlo dos veces devuelve el mismo timer. Solo la asignación de filas nuevas
de MEMORIA tiene una sección serial breve para evitar sobrescribir otra alta. Se revisa el vencimiento antes de cada recordatorio; no se envían
recordatorios de recuperación en ráfaga. La hora se obtiene de
`America/Guayaquil`, independiente del timezone del servidor.

Horario definitivo centralizado en `HORARIO_RETIRO` de `server.js`:
Lunes–viernes: 09:00–antes de 17:00. Sábado: 09:00–antes de 12:00. Domingo no se
recuerda; se mueve al lunes. Los recordatorios fuera de horario se desplazan
al siguiente período operativo. Son reglas de Level Up, no horarios de todas
las agencias. Las alertas administrativas de cierre sí pueden salir fuera de
ese horario, al detectar las 72 horas cumplidas.

- Hora concreta: siguiente comprobación 10 minutos después, ajustada al horario
  operativo. Por ejemplo, “hoy a las 2” se interpreta como 14:00 en este contexto
  comercial (1–7 sin AM/PM se consideran de tarde); “2 AM” conserva AM. Se guarda
  la interpretación. Una hora pasada o inválida requiere aclaración.
- Franja mañana: 09:00–12:00; tarde: 13:00–17:00; después del almuerzo: 13:00–15:00.
  Se programa dentro de la franja cuando es operativa, sin inventar una hora de
  retiro del cliente (`horaRetiroEstimada=null`). “Mañana en la mañana” usa el día
  siguiente. Si la franja ya pasó, se pide aclaración.
- “En un rato” permanece ambiguo: no se inventa precisión.
- Sin horario se inicia aproximadamente 2 horas después de LLEGO. Después de
  cada intento se programa aproximadamente +2 horas, ajustado a operación.
- El plazo es **72 horas reales**, no cuatro días ni tres días laborables.
  Conversar o posponer el retiro no extiende `fechaLlegada`.

### Persistencia e idempotencia

Todos estos campos se guardan dentro del JSON existente de MEMORIA:

| Campo | Uso |
| --- | --- |
| `fechaLlegada` | Ancla inmutable del máximo de 72 horas. |
| `seguimientoRetiro` | Indicador histórico; solo es operativo con estado disponible, guía, fechaLlegada y sin fechaPago. |
| `proximaVerificacionRetiro` | Fecha ISO del siguiente intento; no opera en terminales. |
| `horarioRetiro`, `fechaRetiroEstimada`, `horaRetiroEstimada` | Tipo concreta/franja y planificación, sin asignar precisión a franjas. |
| `ultimoRecordatorioProgramado`, `ultimoRecordatorioIntento` | Reserva duradera previa al envío. |
| `ultimoRecordatorio`, `ultimaVerificacionRetiro` | Último envío aceptado por Meta. |
| `fechaCierreSinRespuesta` | Momento de cierre al detectar el vencimiento. |
| `alertaPagado`, `alertaSinRespuesta` | Estado pendiente/reservada/enviada/fallida, intentos (máximo 3), fechaIntento y fechaEnvio al tener éxito. |
| `estado`, `fechaPago`, `fechaRetiro` | Cierre cobrado; nunca se asigna por vencimiento. |
| `avisoLlegada` | Mismo control de intentos y estados que las alertas; independiente de fechaLlegada. |

La reserva y la próxima fecha se guardan **antes** de enviar. Después del éxito
se persiste la confirmación del envío. Así, caer después de enviar no repite
inmediatamente un recordatorio ni una alerta al reiniciar. Si falla la escritura
previa, no se envía. Los estados terminales se leen desde MEMORIA antes de
transcribir audio, clasificar mensajes, descargar medios o consultar stock.
Los mensajes de esos clientes reciben HTTP 200 sin respuesta automática ni
nueva venta o APRENDIZAJE. La postventa corresponde al equipo humano.

### Límites operativos explícitos

Sheets y WhatsApp no ofrecen aquí una transacción conjunta. Aviso LLEGO y
alertas PAGADO/SIN_RESPUESTA tienen **máximo 3 intentos persistentes**, separados
por al menos 60 segundos (`MAX_INTENTOS_AVISO`, `REINTENTO_AVISO_MS`). El contador
se guarda antes del envío. Fallos y reservas interrumpidas se recuperan al
reiniciar; un estado `enviada` persistido nunca se reenvía. Las alertas de cierre
se recuperan aun con pedido terminal, sin activar el flujo cliente. Al agotar
los intentos se requiere revisión manual. Los recordatorios conservan su
reserva y próxima fecha (+2 horas), sin reintento inmediato del mismo intervalo.

Si Meta aceptó el envío pero no se pudo persistir el éxito, un reintento posterior
**puede duplicarlo**. No es posible garantizar exactamente una entrega con estas
dos APIs sin una transacción/idempotencia compartida. HTTP exitoso significa
aceptación de Meta, no entrega/lectura. Reservas antiguas sin contador no permiten
reconstruir intentos previos; requieren revisión al migrar datos de una versión
anterior. No se modificaron filas reales durante estas pruebas.

El diseño admite **una instancia Node**. Dos procesos/replicas no comparten la
exclusión y Sheets no tiene compare-and-swap: no se garantiza idempotencia
entre réplicas. Una llamada lenta retrasa solo a ese cliente; Sheets sigue siendo un recurso
compartido sujeto a latencia y cuotas. Un servicio dormido, una caída o falta de acceso a Sheets impiden ticks;
al reanudarse, cierra los pedidos vencidos sin mandar recordatorios atrasados.
Normalmente el cierre ocurre en el primer tick posterior al plazo (hasta unos
60 segundos de retraso, más latencia). No existe ejecución mientras Render está
apagado. No se modificó Render ni se probaron servicios reales.

Los recordatorios libres por WhatsApp están sujetos a la ventana y permisos de
la cuenta: Meta puede rechazarlos. V1 no añade plantillas automáticas; esos
errores se registran sin PII y requieren coordinación operativa.

Pruebas adicionales: `node scripts/test-ciclo-administrativo.js`. Simulan Sheets,
WhatsApp, reinicios y reloj; los datos son sintéticos. Las 66 pruebas anteriores
se conservan sin edición ni debilitamiento.

La intención de atención humana tiene prioridad durante `disponible_retiro` y
usa la respuesta existente de pedido registrado sin alterar estado ni horario.
La clasificación de retiro solo acepta localmente expresiones completas; el
resto usa semántica con prioridad SOLICITA. “Ya lo tengo claro” y “ya tengo la
guía” no significan pago. Un vencimiento de 72 horas sigue teniendo prioridad
sobre todo mensaje y no depende del horario de recordatorios.

### Inventario final y GUIA V2

GUIA registra todas las líneas en REGISTRO DE VENTAS con estado `enviado`;
Sheets recalcula el stock. El backend no escribe DATOS!P ni RE-STOCK.
Incluye revalidación integral, recuperación de escrituras inciertas y exclusión
entre pedidos dentro de una instancia Node. El aviso de envío precede al silencio
por atención humana. Detalles, límites y pruebas en [IMPLEMENTACION_INVENTARIO.md](IMPLEMENTACION_INVENTARIO.md).
