# SPEC — Chatbot WhatsApp Level Up Store V2

Versión funcional inicial: 2026-09-16. Estado: Día 1 — implementación #1 completada localmente; ver IMPLEMENTACION_DIA1.md. Integración de inventario final autorizada; calendario completo de retiro pendiente.

## Autoridad y mantenimiento

Este archivo es la única fuente de verdad funcional del proyecto. Ninguna IA puede cambiar reglas por iniciativa propia. Las reglas se implementan tal como están definidas aquí. Los cambios funcionales requieren instrucciones explícitas del propietario y actualización de esta especificación. README, prompts, pruebas V1 e informes históricos describen la implementación; no reemplazan estas reglas.

La implementación #1 del Día 1 está autorizada: router, estados compatibles, controles humanos, entrada protegida, privacidad y preparación de pedidos/modelos. El bloque posterior de integración final autoriza registrar ventas y actualizar estados para que Sheets recalcule stock; prohíbe tocar RE-STOCK o DATOS!P y no autoriza el calendario completo de retiro. Conservar funcionalidades que no entren en conflicto con esta especificación.

## Estados oficiales
- nuevo
- interesado
- recopilando_datos
- esperando_confirmacion
- confirmado
- enviado
- disponible_retiro
- retirado
- cerrado
- abandono
- no_interesado
- postventa_humano
- human_takeover
- no_retirado
- spam

retirado = pagado.

## Reglas principales

- El bot solo atiende ventas nuevas y logística.
- Después de una venta, cualquier consulta sobre la compra anterior es POSTVENTA y pasa a humano.
- Un chat cerrado que diga solamente hola, gracias, ok, emojis, etc. se ignora sin llamar a OpenAI.
- Un chat cerrado puede reactivarse únicamente si existe intención positiva explícita de NUEVA COMPRA.
- Ejemplos: “quiero comprar”, “me interesa”, “quiero otra”, “quiero otro equipo”, etc.
- Las negaciones deben impedir falsos positivos: “no quiero comprar otra” NO reactiva.
- “No estoy interesado” cierra esa oportunidad y cancela seguimientos. Si en el futuro el cliente inicia expresamente una nueva compra, puede abrirse una nueva oportunidad.
- “No me escriban” activa NO_CONTACTAR. Nosotros no iniciamos más mensajes. Si posteriormente el propio cliente inicia explícitamente una nueva compra, puede reactivarse.
- Cualquier postventa: garantía, devolución, daño, configuración, cargador, equipo anterior, reclamo, “me estafaron”, etc. => human_takeover y aviso al administrador.
- Aviso POSTVENTA al administrador: nombre si existe + número + último mensaje.
- Si un mensaje mezcla postventa y nueva compra, POSTVENTA tiene prioridad.
- Insulto sin relación con compra => spam/silencio.
- Reclamo relacionado con compra => postventa humana.
- Empleo, proveedores, alianzas o mensajes que no sean intención de compra => silencio.
- Imágenes y documentos del cliente NO se interpretan en V2.
- Audios máximo 3 minutos.
- Ventana de agrupación de mensajes: 5 segundos.
- Rate limit inicial: 20 mensajes/minuto por número.
- Los webhooks duplicados deben detectarse mediante message_id.
- Nunca responder a mensajes generados por el propio bot.
- Los comandos administrativos solo pueden venir del número autorizado configurado por variable de entorno.
- No hardcodear el número administrativo directamente en múltiples archivos.

## Comandos del administrador
- GUIA <ID_PEDIDO> <NUMERO_GUIA>
- LLEGO <NUMERO_GUIA>
- TOMAR <NUMERO>
- LIBERAR <NUMERO>
- DERIVAR <ID_PEDIDO>

## Tomar
- activa human_takeover
- el bot deja de contestar completamente.

## Liberar
- desactiva human_takeover.
- si el pedido ya tiene guía, no vuelve al flujo comercial normal; queda en modo logístico.

## Pedidos
- ID formato LU0001, LU0002, etc.
- Puede haber múltiples productos en una misma orden.
- Cada línea contiene:
  producto
  capacidad
  color si aplica
  cantidad
  precio
- Datos obligatorios del cliente:
  nombre completo
  cédula
  teléfono tomado automáticamente del número de WhatsApp
  provincia
  ciudad
- Antes de confirmar mostrar:
  nombre
  cédula
  teléfono
  provincia
  ciudad
  producto(s)
  cantidad(es)
  precio
- Pedir confirmación expresamente.
- Aceptar confirmaciones como:
  CONFIRMO
  sí
  correcto
  todo bien
  y equivalentes inequívocos.
- Si existen datos contradictorios, usar el dato más reciente.
- Antes de GUIA pueden modificarse los datos del pedido.
- Después de GUIA cualquier cambio pasa a humano.

## Flujo de venta
1. responder pregunta
2. identificar modelo/producto
3. enviar foto o video
4. características
5. qué incluye
6. explicar envío
7. preguntar si desea registrar compra
8. recopilar datos faltantes
9. mostrar resumen
10. pedir confirmación
11. registrar pedido

- Siempre debe enviarse video cuando exista multimedia configurada.
- No existe delivery local. Todo Ecuador usa contraentrega por Servientrega.
- El bot NO selecciona agencia de Servientrega. Informa que un asesor la confirmará posteriormente.

## Pedidos > $300
- Contraentrega soporta máximo $300.
- $300 exactos pueden continuar.
- Si total > $300:
  avisar al administrador
  congelar chat
  pasar a gestión humana
  no completar cierre automático.

## Stock
- Fuente oficial: Google Sheets / PAGINA DE STOCK / DATOS.
- Precio y stock jamás se inventan.
- Stock no se reserva al confirmar pedido.
- El stock SOLO se descuenta al ejecutar GUIA, mediante las fórmulas de Sheets al registrar ventas enviadas; nunca con un segundo descuento del backend.
- Puede haber varios pedidos confirmados aunque quede 1 unidad.
- <=5 unidades: “Nos quedan muy pocas unidades disponibles”.
- 1 unidad: “Nos queda la última unidad disponible”.
- 0 unidades para un cliente nuevo: agotado temporalmente y no permitir registrar nuevo pedido.
- Pedidos previamente confirmados que luego encuentran stock 0: congelar y esperar decisión humana.
- Stock negativo está prohibido.
- En pedidos multi-producto, GUIA debe validar todas las líneas antes de descontar alguna.
- Si falta stock en una línea, no hacer descuento parcial.

## Guia
- validar pedido
- validar stock
- registrar venta en Sheets
- permitir que Sheets descuente la cantidad completa a partir de las filas enviado, sin escribir stock directamente
- guardar guía
- cambiar a enviado
- avisar al cliente
- activar human_takeover automáticamente
- el administrador luego usa LIBERAR cuando termina de enviar manualmente fotos/videos/guía.

Si stock insuficiente al recibir GUIA:
- NO descontar
- NO enviar al cliente
- congelar pedido
- avisar administrador
- opciones humanas:
  actualizar stock
  DERIVAR

## Derivar
- se usa para pedidos confirmados que se pasan a competencia/proveedor.
- cerrar pedido
- closure_reason=derivado_competencia
- cancelar seguimientos
- no volver a llamar OpenAI para ese pedido.

## Seguimiento comercial
- 48 horas exactas desde último mensaje del cliente.
- segundo seguimiento a 96 horas exactas.
- mensajes fijos, sin modelo caro.
- texto base:
  “Qué tal, buenos días. Le escribo para saber si aún está interesado en poder registrar su pedido.”
- si responde, continuar desde el punto previo.
- Después de enviar el segundo mensaje a las 96h, cerrar esa oportunidad para seguimientos automáticos. Una nueva compra explícita posterior crea otra oportunidad.
- un pedido confirmado cancela todos los seguimientos comerciales.

## Llego / retiro
- LLEGO avisa inmediatamente que el producto está disponible.
- después comienza seguimiento cada 4 horas.
- lunes a viernes: 08:00 a 17:00.
- sábado: 08:00 a 12:00.
- domingo: sin seguimiento.
- si las 4 horas caen fuera de horario, mover al siguiente horario permitido.
- si cliente da hora exacta de retiro, pausar recordatorios repetitivos y verificar después de esa hora.
- si dice algo ambiguo como “en la tarde”, “esta semana”, “en estos días”, mantener seguimiento normal.
- primeros 3 días laborales: seguimiento automático.
- al terminar el tercer día sin confirmación: avisar NO RETIRÓ al administrador y silenciar bot.
- el cuarto día laboral queda exclusivamente para gestión humana.
- una imagen NO confirma retiro.
- aceptar frases textuales como:
  confirmo
  ya retiré
  ya lo tengo
  ya lo recogí
  gracias, ya me llegó
  y equivalentes inequívocos.
- estas frases solo cierran si el estado es disponible_retiro.
- al confirmar retiro:
  asumir pagado
  mandar último “Gracias por su compra”
  avisar al administrador:
    nombre
    número
    producto
    guía
    precio
  cerrar chat.

## Datos
- La cédula se elimina 30 días después de created_at del pedido.
- Conservar teléfono y datos operativos necesarios del pedido.
- Lead abandonado: limpiar a los 30 días desde abandoned_at/closed_at.
- cerrar chat significa no llamar modelo y cancelar automatizaciones, no necesariamente borrar información operativa.

## Persistencia
- Google Sheets sigue siendo memoria operativa en V2.
- Render sigue siendo backend.
- Los timers NO pueden depender solo de RAM.
- Deben persistirse datos como:
  last_customer_message_at
  next_followup_at
  followup_stage
  arrived_at
  next_pickup_reminder_at
  pickup_deadline
- tras reinicio de Render, los seguimientos deben poder reconstruirse.

## Modelos openai
- OpenAI es el único proveedor que responde a clientes en producción.
- Preparar arquitectura configurable con niveles:
  LOW
  NORMAL
  HIGH
- modelos concretos deben venir de .env.
- LOW para conversaciones sencillas.
- NORMAL para conversación comercial habitual.
- HIGH solo para casos realmente complejos.
- reglas determinísticas no deben llamar modelo.
- Grok solo se utiliza en desarrollo/auditoría.

## Multimedia
Crear/preparar estructura para hoja MULTIMEDIA:
PRODUCTO | CAPACIDAD | COLOR | TIPO | URL

## Pruebas
- TEST_MODE debe existir.
- pruebas automáticas no deben escribir a clientes reales ni modificar stock real.
- pruebas finales reales sí pueden utilizar stock real.

## Logs y métricas
Registrar:
- número
- pedido
- estado anterior
- estado nuevo
- regla disparada
- llamada o no a modelo
- modelo utilizado
- tokens de entrada
- tokens de salida
- transcripción si aplica
- costo estimado por conversación/pedido
- errores.

## Prioridad del router
1. comandos administrativos
2. human_takeover
3. postventa
4. no_contactar / spam / estados cerrados
5. nueva compra explícita
6. logística
7. conversación comercial
8. OpenAI solo si ninguna regla determinística resuelve el mensaje

## Resoluciones oficiales — implementación #1

Estas resoluciones precisan las secciones anteriores y prevalecen sobre cualquier descripción V1.

1. POSTVENTA:
postventa_humano representa el estado/motivo funcional.
human_takeover=true representa el bloqueo efectivo de respuestas.
Conservar información/estado previo del pedido para no perder trazabilidad.
Postventa siempre activa human_takeover.

2. LLEGO DURANTE HUMAN TAKEOVER:
Si llega un comando LLEGO válido mientras human_takeover=true:
- actualizar estado/timers persistentemente;
- NO enviar mensaje al cliente todavía;
- al LIBERAR, ejecutar la notificación logística pendiente una sola vez.
TOMAR significa silencio real.

3. MULTI-PRODUCTO:
Toda validación de stock para GUIA debe ser atómica.
Primero validar todas las líneas.
No realizar ninguna escritura/descuento hasta confirmar que todas son válidas.
No permitir descuentos parciales.

4. PEDIDOS > $300:
Se pueden conservar/registrar los datos del pedido internamente.
Si total > 300:
- human_takeover=true
- avisar administrador
- no continuar cierre/logística automática.
300 exactos continúan normalmente.

5. SEGUIMIENTO 48/96:
48h = primer mensaje fijo.
96h = segundo y último mensaje fijo.
Después de enviar el mensaje de 96h, esa oportunidad queda cerrada para seguimientos automáticos.
Si el usuario posteriormente inicia explícitamente una nueva compra, se crea nueva oportunidad.

6. DÍAS LABORALES DE RETIRO:
Lunes a sábado cuentan como laborales.
Domingo no.
El día de LLEGO cuenta como día laboral 1 únicamente si la activación/notificación ocurre dentro de una ventana operativa.
Si ocurre fuera de horario, el conteo empieza en la siguiente ventana/día laboral válido.

7. RETENCIÓN:
Cédula: eliminar 30 días después de created_at del pedido.
Lead abandonado: limpiar 30 días después de abandoned_at/closed_at.
Conservar teléfono y datos operativos permitidos.

8. PRECIO MULTI-PRODUCTO:
Cada línea:
- precio_unitario
- cantidad
- subtotal
Total pedido = suma de subtotales.

9. ID PEDIDO:
Formato LU0001...
Debe ser persistente.
Antes de asignarlo verificar en Sheets que no exista.
No depender solo de un contador en RAM.

10. AUDIO > 3 MIN:
No transcribir.
Usar respuesta fija económica indicando que el audio debe durar máximo 3 minutos o que puede escribir su consulta.
No llamar modelo para ese contenido.

11. MULTIMEDIA FALLIDA:
No inventar URL.
Registrar error técnico.
Continuar con información textual disponible.
No romper todo el flujo de venta por un archivo multimedia fallido.

12. COMANDOS V1:
PAGO y RETIRADO ya NO son comandos administrativos válidos en V2.
No deben cambiar estados.

13. NUEVA COMPRA DURANTE LOGÍSTICA:
Un número puede tener más de una oportunidad/pedido.
Si cliente con pedido enviado/disponible expresa intención inequívoca de NUEVA compra:
- crear nueva oportunidad independiente;
- no modificar el pedido anterior.
Si el mensaje es sobre el producto anterior, es postventa.

14. RESPUESTAS MÍNIMAS A FOLLOW-UP:
“ok”, emoji, “gracias” cuentan como actividad pero NO como intención suficiente para avanzar.
No llamar un modelo caro solo por ellas.

15. DEDUPLICACIÓN:
message_id se valida y deduplica ANTES del buffer de agrupación de 5 segundos.

16. DERIVAR:
debe cancelar todos los timers/jobs/next actions asociados al pedido.

17. PRIVACIDAD:
No registrar indiscriminadamente:
- cuerpos completos de mensajes
- cédulas
- tokens
- credenciales
- secretos
- URLs sensibles
Usar logs minimizados/redactados.

18. YCLOUD:
La auditoría encontró que YCloud puede responder aunque la documentación/reglas indiquen silencio.
Localiza esa ruta.
Asegúrate de que todas las salidas hacia cliente pasen por el router/guardas de estado.
Ningún proveedor/ruta secundaria puede saltarse human_takeover, estados cerrados o silencio.

## Alcance pendiente

La estructura final de DATOS, PAGINA DE STOCK y REGISTRO DE VENTAS queda definida en la siguiente sección. No ejecutar migración masiva de IDs antiguos ni descuentos manuales. Retención, calendario laboral completo y seguimientos comerciales se implementarán en bloques posteriores conforme a las reglas ya resueltas.

## Integración final de inventario y ventas — resolución oficial

ARQUITECTURA FINAL DE GOOGLE SHEETS

Tenemos 3 hojas principales dentro de STOCK_SPREADSHEET_ID:

1. DATOS
2. PAGINA DE STOCK
3. REGISTRO DE VENTAS

1. HOJA DATOS

Esta hoja es administrada manualmente por el usuario para RE-STOCK.

ChatGPT/backend NO debe modificar RE-STOCK.

Estructura relevante:

B = FECHA
C = PRODUCTO
D = CAPACIDAD
E = COLOR
F = RE-STOCK
G = ID-PRODUCTO

Catálogo maestro:

L = ID-PRODUCTO
M = PRODUCTO
N = CAPACIDAD
O = COLOR
P = STOCK
Q = PRECIO
R = INFORMACION DEL PRODUCTO

Cada combinación producto + capacidad + color tiene un ID-PRODUCTO único.

Ejemplos:
IPADAIR1-16-BLA
IPADAIR1-16-PLA
IPADAIR1-32-BLA
IPADAIR1-32-PLA

No se permiten celdas de COLOR como:
“blanco, plateado”

Cada color debe tener su propia fila/ID único.

STOCK en DATOS es calculado por fórmula de Sheets.

El backend NO debe escribir directamente sobre DATOS!P.

2. HOJA PAGINA DE STOCK

Esta hoja es de lectura para el chatbot.

Solo muestra productos con STOCK > 0.

Estructura:

A = ID-PRODUCTO
B = PRODUCTO
C = CAPACIDAD
D = COLOR
E = STOCK
F = PRECIO
G = INFORMACION DEL PRODUCTO

REGLA:
El chatbot debe usar PAGINA DE STOCK como fuente principal para saber:
- qué productos están disponibles;
- qué variante exacta está disponible;
- stock actual;
- precio;
- información/características.

Si un ID-PRODUCTO no aparece en PAGINA DE STOCK:
se considera sin stock disponible.

No inventar disponibilidad.

3. HOJA REGISTRO DE VENTAS

Datos empiezan en fila 5.

Estructura final:

B = FECHA
C = ID PEDIDO
D = METODO
E = GUIA
F = ESTADO
G = FECHA ENVIO
H = DIA RETIRO
I = NOMBRE DE CLIENTE
J = TELEFONO
K = CEDULA
L = PROV
M = CIUDAD
N = SERVIENTREGA
O = ID-PRODUCTO
P = PRODUCTO
Q = CAPACIDAD
R = COLOR
S = CANT
T = PRECIO UNITARIO
U = VALOR
V = ENVIO
W = NETO

En esta hoja:
- ID-PRODUCTO se escribe/selecciona.
- PRODUCTO se completa por fórmula desde ID-PRODUCTO.
- CAPACIDAD se completa por fórmula desde ID-PRODUCTO.
- COLOR se completa por fórmula desde ID-PRODUCTO.
- PRECIO UNITARIO se completa por fórmula desde ID-PRODUCTO.
- VALOR se calcula automáticamente.
- NETO se calcula automáticamente.

NO sobrescribir fórmulas preexistentes en P/Q/R/T/U/W.

ESTADOS válidos operativos:
- enviado
- en agencia
- pagado
- devuelto

La lógica de stock en Sheets ya está configurada así:

RE-STOCK
- enviado
- en agencia
- pagado
+ devuelto

Por tanto:
- enviado resta;
- en agencia sigue restado;
- pagado sigue restado;
- devuelto suma de nuevo esa cantidad al stock.

MUY IMPORTANTE:
El backend NO debe hacer un “segundo descuento” manual.
Registrar la fila con estado enviado es lo que hace que Sheets recalculé el stock.

FUNCIÓN DEL CHATBOT RESPECTO AL INVENTARIO

El backend/ChatGPT:

SÍ:
- lee PAGINA DE STOCK;
- lee DATOS como catálogo maestro;
- responde características desde Sheets;
- valida stock antes de confirmar operaciones;
- registra ventas en REGISTRO DE VENTAS cuando llega GUIA;
- actualiza estados de la venta;
- usa ID-PRODUCTO como clave principal.

NO:
- modifica RE-STOCK;
- inventa stock;
- modifica directamente DATOS!P;
- combina colores en una sola variante;
- usa nombre/capacidad/color como llave principal cuando existe ID-PRODUCTO.

COMANDO GUIA

Formato:

GUIA <ID_PEDIDO> <NUMERO_GUIA>

Ejemplo:
GUIA LU0001 123456789

Al recibir GUIA:

1. Validar administrador autorizado.
2. Buscar pedido por ID PEDIDO.
3. Leer todas las líneas del pedido.
4. Cada línea debe tener ID-PRODUCTO.
5. Leer PAGINA DE STOCK y validar disponibilidad de cada ID-PRODUCTO.
6. Validar que stock disponible >= cantidad solicitada para TODAS las líneas.
7. La validación debe ser atómica a nivel lógico:
   si falla una línea, no registrar ninguna.

Si stock insuficiente:
- no escribir ninguna fila en REGISTRO DE VENTAS;
- no cambiar stock;
- no enviar confirmación al cliente;
- congelar pedido;
- avisar administrador;
- esperar decisión:
  actualizar stock o DERIVAR.

Si stock suficiente:

8. Encontrar N filas consecutivas disponibles desde fila 5.
No usar append ciego porque hay fórmulas prellenadas.

9. Una fila por cada línea/producto del pedido.

10. Escribir en cada fila:

B FECHA = fecha actual America/Guayaquil
C ID PEDIDO
D METODO = CONTRAENTREGA
E GUIA
F ESTADO = enviado
G FECHA ENVIO = fecha actual America/Guayaquil
H DIA RETIRO = vacío
I NOMBRE DE CLIENTE
J TELEFONO
K CEDULA
L PROV
M CIUDAD
N SERVIENTREGA = vacío por ahora
O ID-PRODUCTO
S CANT
V ENVIO = vacío por ahora

NO escribir manualmente en:
P PRODUCTO
Q CAPACIDAD
R COLOR
T PRECIO UNITARIO
U VALOR
W NETO
si esas celdas contienen fórmulas.

11. Guardar guía en el pedido.
12. estado pedido = enviado.
13. human_takeover = true.
14. enviar notificación correspondiente al cliente según SPEC.
15. admin luego usa LIBERAR.

IDEMPOTENCIA GUIA

Si llega de nuevo:
GUIA LU0001 123456789

y ya fue registrada:
- no crear duplicados;
- no registrar segunda vez;
- no descontar stock otra vez;
- devolver resultado idempotente.

Si mismo ID PEDIDO llega con una guía diferente:
- no reemplazar silenciosamente;
- congelar;
- avisar administrador;
- no escribir cambios hasta resolución humana.

PEDIDOS MULTIPRODUCTO

Ejemplo:
LU0005:
- 2 x IPADAIR1-32-PLA
- 1 x CHROMEBOOK-DELL

Debe crear 2 filas:
una por línea/producto.

Mismo:
- ID PEDIDO
- GUIA
- datos cliente

Diferente:
- ID-PRODUCTO
- CANT

Toda validación de stock debe ocurrir antes de escribir una sola fila.

ACTUALIZACIÓN DE ESTADOS

Preparar/ajustar funciones para localizar una venta por:
- ID PEDIDO
o
- GUIA

y actualizar ESTADO en REGISTRO DE VENTAS.

ESTADOS:
enviado
en agencia
pagado
devuelto

Cuando estado cambia:
NO modificar stock directamente.
Sheets recalcula stock automáticamente.

Ejemplo:
enviado -> pagado
sigue restado.

pagado -> devuelto
Sheets devuelve automáticamente la cantidad al stock.

FECHAS

El Apps Script manual ya coloca fechas cuando una persona edita la hoja,
pero las escrituras del backend NO deben depender de onEdit.

Por eso:
- GUIA debe escribir FECHA y FECHA ENVIO explícitamente.
- cuando backend marque pagado/retiro, debe escribir DIA RETIRO explícitamente si está vacío.

Timezone:
America/Guayaquil

LECTURA PARA RESPUESTAS DEL BOT

Actualizar la capa que consulta inventario para que:

1. lea PAGINA DE STOCK;
2. use ID-PRODUCTO como clave;
3. solo ofrezca filas visibles/disponibles con stock > 0;
4. use PRECIO de la hoja;
5. use INFORMACION DEL PRODUCTO de la hoja;
6. no use valores hardcodeados si existe dato en Sheets.

Si hay:
stock <= 5
puede indicar:
“Nos quedan muy pocas unidades disponibles.”

Si stock == 1:
“Nos queda la última unidad disponible.”

No revelar cantidades exactas entre 2 y 5.

## Historial de cambios

- 2026-09-16: especificación inicial y auditoría.
- 2026-09-16: incorporadas las 18 resoluciones oficiales; autorizado Día 1, implementación #1.
- 2026-09-16: implementación #1 verificada localmente; detalles y límites técnicos en IMPLEMENTACION_DIA1.md, sin cambios adicionales de reglas.
- 2026-09-16: autorizada integración con estructura final de inventario/ventas; Sheets calcula existencias a partir del registro, sin escritura del backend sobre RE-STOCK ni DATOS!P. Sin despliegue ni calendario completo de retiro.
- 2026-09-16: GUIA conectado al flujo real con intención durable, reconciliación por pedido/guía y exclusión con DERIVAR. Insuficiencia: cero ventas, estado del pedido conservado y alerta humana. Alcance de concurrencia: una instancia Node. Se mantienen fuera de este bloque LLEGO y calendario de retiro. Ver IMPLEMENTACION_INVENTARIO.md para pruebas y límites de APIs externas.
