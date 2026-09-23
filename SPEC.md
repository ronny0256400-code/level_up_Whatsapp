# Level Up Store WhatsApp — SPEC V2.5

Esta especificación sustituye las resoluciones V1/V2 contradictorias. El código
controla estados y escrituras; la IA interpreta lenguaje; Sheets calcula stock.
YCloud es el proveedor principal. Meta permanece disponible. No se despliega
esta migración sin revisar la fórmula de inventario y las pruebas reales.

## Seguridad, entrada y persistencia

- Webhooks Meta/YCloud autenticados con sus firmas sobre bytes originales.
- Deduplicación persistente en ENTRADAS_V2, buffer fijo de cinco segundos,
  rate limit de 20 entradas/minuto y aislamiento por número.
- Los fallos permanentes se ponen en cuarentena; los transitorios tienen
  backoff y un máximo de tres intentos. No hay loop infinito de ingress_retry.
- MEMORIA!A2:C mantiene el snapshot JSON, oportunidades e intents/outboxes.
- TEST_MODE sustituye Sheets por memoria y bloquea API/modelos/transporte real.
- Meta conserva además deduplicación en RAM: es deuda técnica. Los locks de
  cliente, inventario y contadores presuponen una sola instancia de backend.
- Logs: eventos, etapa, estado, IDs internos, códigos, métricas y fingerprints.
  Nunca cuerpos completos, cédulas, teléfonos completos, transcripciones,
  credenciales, audio, contenido TTS ni URLs firmadas.

## Identidades

ID_PEDIDO conserva LU0001, LU0002… y su contador persistente __V2_COUNTER__.
ID_CHAT usa CH000001, CH000002… con __V25_CHAT_COUNTER__ y comprobación de
colisiones contra pedidos vigentes e históricos. Ambos contadores se reservan
antes de confirmar; los huecos después de una caída son válidos.

ID_CHAT nace exclusivamente al confirmar el resumen de un pedido normal.
No se crea al saludar, seleccionar producto, elegir agencia ni pedir ayuda.
Se persiste en pedido.id_chat, vinculado a pedido.id y posteriormente a guía.
Un ciclo posterior genera otra identidad y conserva los pedidos normales previos.

## Estados

Estados nuevos: nuevo, interesado, recopilando_datos, esperando_confirmacion,
confirmado, enviado, disponible_retiro, retirado, cancelado, cerrado, abandono,
no_interesado, postventa_humano, human_takeover y spam.

Lectura histórica: pagado → retirado; sin_respuesta/no_retirado → cancelado.
Se conserva legacy_estado, fechaPago e historia; legacy_terminal impide reabrir
esos pedidos o reactivar seguimientos. No se escriben nuevos estados legacy.
Un cancelado nuevo puede pasar a retirado si el retiro se confirma realmente;
la transición agrega evento, fecha y cancela timers. No cambia a devuelto.

## Flujo comercial

1. Saludo abierto sin asumir producto.
2. Selección entre variantes disponibles del catálogo. Matching local y, cuando
   hace falta, interpretación LOW limitada a candidatos existentes. No se elige
   arbitrariamente color/capacidad entre variantes. Cantidad inicial: uno.
3. Características reales, fotos por orden numérico, video comercial, precio y
   promoción, AudioComercial1. La multimedia comercial no representa el equipo
   individual que será despachado.
4. Ciudad/provincia: inferir provincia si la ciudad es inequívoca, admitiendo
   un typo seguro. Pedir aclaración ante homónimos. Elección expresa de agencia.
5. Solo después se solicita nombre completo y cédula por texto. El teléfono
   proviene de WhatsApp. No se solicita otra vez. Cédula sin checksum ni
   validación legal; el administrador revisa antes de GUIA.
6. Resumen por texto: contraentrega, nombre, cédula, teléfono, provincia, ciudad,
   agencia/dirección, líneas, capacidad, color, cantidad, unitario, subtotal,
   total y envío gratis. Se pregunta si está correcto.
7. Confirmación híbrida: matcher local primero; LOW solo para lenguaje ambiguo.
   Admite sí, sí amigo, correcto, está bien, dale, mándelo, proceda, confirmo,
   dale de una, hágale, envíelo, está coredto, perfecto continuemos y equivalentes claros. Negaciones, correcciones,
   preguntas, dudas y condiciones nunca confirman automáticamente.
8. Incomplete/sin texto de LOW es un fallo controlado: conserva el resumen,
   emite una instrucción una vez y permite confirmación local posterior.

Correcciones invalidan el dato relacionado. Cambiar ciudad/provincia/agencia
obliga a elegir de nuevo una agencia válida; no conserva la de otra localidad.
La IA no crea precios, productos, agencias, guías, estados ni mutaciones.

Las preguntas cuyo dato no consta de forma verificable, contradicciones y
casos que necesitan decisión humana generan pendingQuestion, conservando
etapa y contexto. El aviso urgente va al asesor configurado por el proveedor
de origen. Se envía una sola alerta por pregunta pendiente. RESPONDER entrega
el contenido humano literal, por texto o TTS según longitud/tipo, y reanuda esa etapa, sin convertirlo en takeover real.

## Confirmación normal y atención humana

Sin límite monetario: revalidar datos/SKU/precio, reservar LU y CH, persistir
pedido.estado=confirmado y human_takeover=true; cancelar followups comerciales.
No escribir REGISTRO DE VENTAS ni modificar stock al confirmar.

El cierre envía «✅ Pedido confirmado correctamente.» y luego audio logístico.
Ambas etapas tienen persistencia independiente. Fecha calculada en Guayaquil:
lunes-viernes hasta 17:00 inclusive sale hoy; después, siguiente día operativo.
Sábado hasta 11:00 inclusive sale hoy; después y domingo, lunes. Se evalúa por
minuto civil (17:01/11:01 ya fuera), no se suman 24 h ciegamente.
El contenido logístico se fija al confirmar y se conserva para reintentos.
Fallo TTS anterior al envío permite el mismo contenido por texto; aceptación
incierta no se duplica. La excepción de salida durante takeover solo sirve para
estos avisos persistidos del mismo pedido, nunca para TOMAR/postventa.
El aviso NUEVO PEDIDO CONFIRMADO incluye CH, LU, nombre, cédula, teléfono,
provincia, ciudad, agencia, líneas/SKU, capacidad/color, cantidades, precios,
subtotales, total, contraentrega y guía pendiente.

Con takeover activo el bot queda silencioso para mensajes normales, audios y
postventa. El asesor envía manualmente los videos del equipo real/empaque y
la guía. GUIA no reactiva el bot. LIBERAR un confirmado/enviado habilita solo
logística. No abre otra compra automática mientras exista un pedido activo
no retirado, incluido cancelado con guía. Después de retirado puede abrirse
otro ciclo cuando el humano haya liberado el chat.

Postventa tiene prioridad sobre nueva compra; con bot activo deriva y pausa,
con takeover existente guarda silencio sin otra alerta automática.

## Monto y ofertas manuales

No existe límite monetario ni purga/derivación por monto. Todos los pedidos
conservan IDs y datos y siguen el mismo flujo; inventario limita cantidades.
No hay excepción de LIBERAR por teléfono.

Una oferta explícita del administrador se vincula solo al SKU y cantidad exacta
del borrador actual. No se aprende como promoción global ni se extrapola a otras
cantidades/clientes. Se recalcula el resumen y requiere confirmación nueva.
El parser solo aplica automáticamente ofertas inequívocas de total para un SKU,
con cantidad explícita y centavos divisibles; ofertas complejas requieren revisión.
Se conserva el precio de catálogo de referencia y GUIA lo revalida. Si cambió,
la oferta no autoriza usar un precio desactualizado.
T/U/W siguen siendo fórmulas: el descuento del pedido no cambia esas columnas.
Conciliar manualmente importes comerciales y contables antes de despachar ofertas.

## Comandos administrativos

Solo ASESOR_WHATSAPP. Paréntesis obligatorios; comando indiferente a mayúsculas.
Referencias ambiguas/cero candidatos no producen mutaciones ni mensajes al cliente.

| Comando | Efecto |
| --- | --- |
| GUIA (CH000001) (GUIA) | Resuelve exactamente un pedido; registra envío/venta |
| LLEGO (GUIA) | enviado → disponible_retiro; persiste llegada y seguimiento |
| RETIRADO (GUIA) | Transición central de retiro, idéntica a la entrada del cliente |
| CANCELADO (CH000001) | Solo antes de guía |
| CANCELADO (GUIA) | Solo después de guía |
| LIBERAR (CH000001) | Quita takeover; conserva fase del pedido |
| RESPONDER (CH000001): respuesta | Resuelve pregunta puntual; no salta takeover real |
| RESPONDER (TELÉFONO): respuesta | Excepción exclusiva para preconfirmación |
| TOMAR (CH000001) / TOMAR (TELÉFONO) | Toma humana explícita |
| DERIVAR (LU0001) / DERIVAR (CH000001) | Cierra confirmado no registrado ni con GUIA incierta |

PAGO no es comando ni alias. No existe comando DEVUELTO.
RESPONDER conserva literal el contenido: largo explicativo usa TTS; cifras,
precios, códigos, datos sensibles/precisos y respuestas cortas usan texto.
Mensajes del administrador sin sintaxis válida permanecen silenciosos.
RESPONDER usa outbox para rechazos reintentables;
un resultado incierto nunca se reproduce ciegamente.

## GUIA y contrato de Sheets

PAGINA DE STOCK: encabezados fila 2, datos exclusivamente A3:G evaluados:
ID-PRODUCTO, PRODUCTO, CAPACIDAD, COLOR, STOCK, PRECIO, INFORMACION DEL PRODUCTO.
H:I son auxiliares. Stock >0 para ofrecer; información vacía permitida. Filas
vacías/aisladas inválidas no destruyen las válidas; IDs duplicados se excluyen.
No usar DATOS como catálogo. DATOS B:G es RE-STOCK; L:R es maestro.

REGISTRO DE VENTAS: encabezados fila 4, filas desde 5, rango B:W.

| Columna | Uso |
| --- | --- |
| B | FECHA |
| C | ID PEDIDO |
| D | METODO |
| E | GUIA |
| F | ESTADO |
| G | FECHA ENVIO |
| H | DIA RETIRO |
| I/J/K | NOMBRE / TELEFONO / CEDULA |
| L/M/N | PROV / CIUDAD / SERVIENTREGA |
| O | ID-PRODUCTO |
| P/Q/R | PRODUCTO / CAPACIDAD / COLOR: fórmulas intactas |
| S | CANT |
| T/U | PRECIO UNITARIO / VALOR: fórmulas intactas |
| V | ENVIO |
| W | NETO: fórmula intacta |

GUIA valida todas las líneas, stock agregado por SKU y precios antes de una
única batchUpdate atómica de B:O, S y V. No hay append parcial. La guía debe ser
única; misma guía/pedido es idempotente, distinta guía congela y alerta.
Un intent persistente y la reconciliación de filas existentes recuperan una
respuesta perdida de Sheets. Lock global de inventario evita competir por la
última unidad dentro de la instancia; lock de cliente coordina GUIA/DERIVAR.

Estados nuevos de ventas: enviado, en agencia, retirado y cancelado.
LLEGO actualiza F; retiro actualiza F/H; cancelación actualiza F. Cancelar no
reincorpora stock. Devuelto es exclusivamente físico/manual.
Nunca escribir DATOS!P, RE-STOCK ni fórmulas P/Q/R/T/U/W de ventas.
Antes de desplegar aplicar la [migración manual](docs/MIGRACION-V2.5.md).

## Retiro, timers y cierres

LLEGO repetido conserva la primera fecha y no reinicia el plazo. En takeover
persiste todo y deja aviso pendiente. LIBERAR lo entrega una vez.

America/Guayaquil: lunes-viernes 08:00–17:00, sábado 08:00–12:00, domingo sin
envíos. Intervalo ordinario: cuatro horas; fuera de ventana pasa a la siguiente.
Tres días laborales: el día de llegada cuenta si está dentro de ventana; si no,
se cuenta desde la siguiente apertura. Sábado cuenta, domingo no. Al cierre del
tercer día: cancelado, F actualizada, timers cancelados y aviso al asesor.
El cuarto día corresponde a gestión humana. Takeover no extiende el plazo.

Hora concreta: comprobar diez minutos después, ajustando ventana. Franja como
mañana/en la tarde es aproximada y no asigna una hora declarada al cliente.
Retiro local inequívoco admite ya retiré/recogí/tengo el equipo/fui a buscarlo/
ya pagué. Complejos pasan por LOW con etiquetas cerradas. Preguntas, promesas,
creo que sí, tener la guía o tener claro algo e imágenes no confirman retiro.

Ambas entradas llaman transitionOrderToRetired. Persistir intent antes de Sheets,
recuperar tras reinicio, conservar IDs/guía/eventos, cancelar acciones, guardar
fechaRetiro y un aviso administrativo; agradecimiento separado cuando la guarda
permite salida. No reescribir fechaPago para retiros nuevos.

Comercial: primer seguimiento a las 48 horas desde el último mensaje del cliente,
segundo y último a las 96; ejecutar en ventana operativa. Textos fijos, sin IA.
El segundo cierra como abandono. Confirmación/takeover cancelan este seguimiento.

## Agencias y multimedia

resources/agencias/Ecuador/<Provincia>/<Ciudad>/SERVIENTREGA.html: único origen.
Los HTML importados ya están filtrados por el propietario para contraentrega.
No buscar afuera, no ejecutar JS ni cargar recursos externos. Parsear las 14
columnas, conservar filas válidas, normalizar tildes/caso/puntuación y usar fuzzy
acotado de una edición. Ambigüedad exige elección; jamás adivinar.
Tarjetas PNG priorizan nombre, dirección, sector y horarios; excluyen supervisor,
email y otros datos internos. Render SVG con @resvg/resvg-js y Noto Sans local,
sin Chromium. Caché limitada. Fallback de tarjeta a texto legible. En ciudades
con muchas agencias se presentan páginas; también se acepta nombre/dirección.

resources/productos/<SKU>/imagen/*.jpg|jpeg|png y video/*.mp4. SKU debe estar
actualmente disponible. Fotos ordenadas numéricamente; falla individual no
bloquea las restantes. Ledger por oportunidad evita reenviar archivos ya
entregados o cuyo resultado sea incierto. Nunca usar flags/env de video iPad.
YCloud sube media por multipart y envía por ID; caché de upload de 25 días,
inferior a los 30 días del proveedor. Imágenes máximo 5 MiB; audio/video 16 MiB.
Cada salida respeta proveedor, takeover, no_contactar y estado cerrado.

## Audio y TTS

Audio entrante Meta/YCloud: descarga autenticada y acotada, duración verificable
máxima de 180 segundos, transcripción MODEL_TRANSCRIPTION y mismo router que
texto. Más de tres minutos no se transcribe. Fallo: pedir texto/audio más corto.
Temporales privados borrados al terminar; dedup y cache de transcripción evitan
llamadas repetidas tras un fallo posterior. Datos personales se solicitan por texto.

TTS: gpt-4o-mini-tts, cedar, speed 1.15, WAV de generación, Opus de entrega,
umbral 250 caracteres. Instrucciones paisas de Medellín/Antioquia, cálidas,
claras, ágiles y naturales. AudioComercial1 usa TTS explícitamente. Las demás
respuestas comerciales largas pueden usar TTS; cortas quedan por texto.
Datos, resumen, agencia elegida, confirmación breve, precio crítico, IDs,
admin y errores son texto. El bloque logístico postconfirmación usa TTS. Se informa que la voz es generada por IA.

WAV → OGG/Opus mediante ffmpeg cuando existe; si falta/falla, pedir Opus directo
a OpenAI. Si generación/conversión falla, enviar el mismo contenido una vez por
texto. Error inequívoco de transporte permite texto; timeout con posible entrega
queda incierto, evitando una duplicación. No enviar WAV directamente a YCloud.
No se necesita custom voice. TEST_MODE no genera ni envía audio real.

## Outboxes y límites de recuperación

Avisos de confirmación conservan el proveedor original y ASESOR_WHATSAPP,
reserva antes de enviar, retry de rechazo explícito y estado incierto ante timeout
u otra aceptación desconocida. No hay garantía de exactamente una entrega entre
un proveedor sin idempotency key y una caída local: se conserva el pendiente para
reconciliación humana y se evita replay ciego. RESPONDER y cierres nuevos aplican
la misma distinción. Los avisos de llegada conservan sus reservas e intentos limitados y también
marcan incierta una reserva sobreviviente o un resultado desconocido. Los
recordatorios reservan su siguiente fecha antes del envío para no repetirlo.

## Variables nuevas y validación

Defaults: OPENAI_TTS_ENABLED=true, OPENAI_TTS_MODEL=gpt-4o-mini-tts,
OPENAI_TTS_VOICE=cedar, OPENAI_TTS_SPEED=1.15, OPENAI_TTS_FORMAT=wav,
OPENAI_TTS_DELIVERY_FORMAT=opus, OPENAI_TTS_MIN_CHARS=250,
AGENCIES_ROOT=resources/agencias/Ecuador, PRODUCT_MEDIA_ROOT=resources/productos.
No modificar secretos existentes. MODEL_LOW/NORMAL/HIGH/TRANSCRIPTION siguen por env.

Validación obligatoria sin APIs reales: npm run check, npm test,
npm run test:v2, npm run test:ycloud y git diff --check.

## Ajustes conversacionales finales

Conceptos comerciales tienen marcador persistente de comunicación reciente;
el audio inicial complementa el precio/promoción y no repite envío gratis.
Bodegas: Guayaquil, sin atención dentro por seguridad; video de empaque y
garantía según contenido aprobado. No se inventa dirección ni duración de garantía.
Mayor capacidad agotada: se explica la alternativa de archivos en Google Drive/
iCloud sin afirmar aumento de memoria física ni almacenamiento interno gratuito.
Características solo de G, precio F, stock E y SKU A. Datos ausentes se escalan.
Agencias: ordinales y nombre/sector desde candidatos mostrados; «esa/la anterior»
solo cuando una única referencia es segura. Terminar opciones con «Indíqueme por
favor a cuál de estas agencias desea que le enviemos el equipo 😊».
Cambios de producto/variante/cantidad invalidan una oferta que ya no corresponda,
recalculan contra catálogo y generan resumen coherente antes de confirmar.
Compra futura/sin dinero: conversación normal, sin nuevo estado/seguimiento ni
reserva por $10. Esa mejora queda fuera de alcance.
