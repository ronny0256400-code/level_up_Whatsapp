QUIERO QUE IMPLEMENTES LA NUEVA VERSIÓN DEFINITIVA DEL BOT DE WHATSAPP DE LEVEL UP STORE.

IMPORTANTE:
- Trabaja SOBRE EL REPOSITORIO ACTUAL.
- NO crees otro proyecto.
- NO hagas push.
- NO hagas deploy.
- NO modifiques producción.
- NO migres ni toques el número viejo de Meta.
- Conserva la integración actual con YCloud, OpenAI, Google Sheets y Render cuando siga siendo útil.
- Antes de editar código, inspecciona completamente el repositorio.
- Reutiliza módulos funcionales cuando tenga sentido.
- Elimina o deja fuera de ejecución la lógica antigua que ya no pertenece a esta versión.
- No hagas cambios destructivos innecesarios.
- Al terminar, ejecuta pruebas exhaustivas y entrégame un informe.
- Si encuentras una contradicción real que no puedas resolver con esta especificación, NO inventes: documéntala en el informe.

==================================================
1. OBJETIVO DE ESTA VERSIÓN
==================================================

Esta nueva versión es deliberadamente más simple.

El bot SOLO se encarga del proceso comercial desde el primer mensaje del cliente hasta la CONFIRMACIÓN FINAL DE LA VENTA.

Después de la confirmación:
- el chat queda PAUSADO;
- el bot no responde;
- no hace logística;
- no genera guía;
- no registra retiro;
- no hace seguimiento;
- no hace postventa;
- no sigue consumiendo recursos en ese chat.

La logística posterior la realizan agentes humanos.

Principio general:

IA ENTIENDE.
CÓDIGO DECIDE.
RESPUESTA APROBADA VENDE.

La IA se utiliza principalmente para:
- interpretar intención;
- entender producto/modelo/variante;
- interpretar lenguaje natural;
- interpretar confirmaciones;
- entender correcciones;
- detectar reclamos;
- responder preguntas técnicas específicas cuando están dentro de las reglas;
- seleccionar qué respuesta preprogramada corresponde.

La IA NO debe improvisar:
- precios;
- stock;
- descuentos;
- políticas;
- promociones;
- características registradas;
- condiciones de reserva;
- garantía;
- información logística oficial.

==================================================
2. NOMBRE DEL NEGOCIO
==================================================

Por ahora el bot seguirá usando:

Level Up Store

Pero el nombre debe quedar desacoplado en configuración, por ejemplo:

BUSINESS_NAME="Level Up Store"

o equivalente.

No hardcodear el nombre por todo el código.

==================================================
3. RECURSOS
==================================================

Existe una carpeta:

resources/

con:

resources/Audios/
resources/Ecuador/
resources/productos/

Debes inspeccionarla completamente.

Ignorar archivos basura de macOS como:
.DS_Store
__MACOSX

==================================================
4. PRODUCTOS Y MULTIMEDIA
==================================================

Dentro de:

resources/productos/

cada SKU tiene su propia carpeta.

Ejemplo conceptual:

SKU/
  imagen/
  video/

Los nombres de los archivos incluyen el SKU.

La relación SKU -> multimedia se debe descubrir de la estructura, no hardcodear manualmente si puede evitarse.

Orden OBLIGATORIO cuando se presenta un producto:

1. FOTO
2. VIDEO
3. CARACTERÍSTICAS
4. AUDIO COMERCIAL 1

NO cambiar este orden.

Foto y video se envían una vez por presentación de ese producto.

Las características corresponden al SKU exacto.

Nunca mezclar multimedia/características entre variantes equivocadas.

MacBook:
- muchos SKU pueden reutilizar el mismo video comercial;
- los modelos de distinto tamaño/pulgadas pueden tener video diferente;
- el video comercial no debe usarse como prueba de RAM/almacenamiento si es genérico;
- las características exactas siempre salen de stock;
- la verificación exacta de la unidad se hace posteriormente por logística humana en los videos de empaque/funcionamiento, fuera del bot.

Windows:
- normalmente hay multimedia distinta por marca/modelo.

iPad:
- usar multimedia según la estructura real disponible.

==================================================
5. FUENTE DE VERDAD: STOCK
==================================================

La fuente oficial de:

- producto;
- SKU;
- stock;
- precio;
- RAM;
- almacenamiento;
- color;
- características;
- información del producto;

es la hoja actual de Google Sheets usada por el proyecto, especialmente PAGINA DE STOCK.

NO usar precios recordados del código como fuente de verdad.

NO asumir que un producto cuesta $100 solo porque una publicidad lo dice.

La publicidad de Windows puede anunciar productos "desde $100", pero algunos modelos cuestan más.

Siempre consultar el precio real del SKU en stock.

Si una fuente entra en contradicción con otra:
- no inventar;
- pausar/escalar el chat;
- documentar la contradicción.

==================================================
6. FLUJO DE VENTA OBLIGATORIO
==================================================

Flujo general:

INICIO
→ IDENTIFICAR PRODUCTO/MODELO
→ IDENTIFICAR VARIANTE SI HACE FALTA
→ FOTO
→ VIDEO
→ CARACTERÍSTICAS
→ AUDIO COMERCIAL 1
→ CIUDAD
→ AGENCIAS o DELIVERY GUAYAQUIL
→ AUDIO COMERCIAL 2 cuando corresponda
→ SELECCIÓN DE AGENCIA / MALL
→ DATOS
→ RESUMEN
→ CONFIRMACIÓN SEMÁNTICA
→ PAUSA TOTAL

No saltarse etapas porque el cliente diga:
"quiero comprar"
"me lo llevo"
"envíamelo"
"quiero reservar"

Preguntas auxiliares pueden ocurrir en cualquier etapa.

Una pregunta auxiliar:
- se responde;
- NO reinicia el flujo;
- NO cambia artificialmente la etapa;
- luego se continúa desde donde estaba la venta.

==================================================
7. ENTRADAS INICIALES
==================================================

TEXTOS INICIALES APROBADOS:

IPAD:

¡Hola! 👋 Sí tenemos disponibles nuestras iPads para estudio y trabajo desde $99,99

Actualmente contamos con:
📱 [MODELOS DISPONIBLES SEGÚN STOCK]

🔥 Esta promoción es únicamente hasta agotar stock.
Además, por promoción del mes, todos nuestros envíos son GRATIS a nivel nacional. 🚚✨

¿Cuál modelo le gustaría conocer?

El bloque de modelos es dinámico según stock.

WINDOWS:

¡Hola! 👋 Sí tenemos disponibles nuestras laptops desde $[PRECIO SEGÚN STOCK].

Actualmente contamos con:
💻 [MARCAS DISPONIBLES SEGÚN STOCK]

🔥 El precio promocional es únicamente hasta agotar stock.
Además, por promoción del mes, todos nuestros envíos son GRATIS a nivel nacional. 🚚✨

¿Tiene alguna marca de preferencia o desea que le recomiende una?

Mostrar solo marcas con stock.

No repetir una marca múltiples veces por variantes.

MACBOOK:

¡Hola! 👋 Sí contamos con MacBook Pro disponibles.

Tenemos diferentes configuraciones de memoria RAM, almacenamiento y procesador.

¿Tiene algún modelo o configuración de preferencia que haya visto, o desea que le envíe nuestro catálogo disponible?

Si pide catálogo, construirlo con SKUs que realmente tengan stock y precio actual.

==================================================
8. RECOMENDACIONES
==================================================

Cuando el cliente diga:
"¿cuál me recomienda?"
"recomiéndeme una"
o equivalente,

si NO especifica requisitos concretos:

seleccionar el producto compatible con MAYOR STOCK.

Esto aplica a:
- Windows;
- iPads;
- MacBook;
- demás productos.

Si dos o más empatan en el mayor stock:
seleccionar cualquiera de los empatados.

Texto comercial aproximado:

"Le comento que esta es una de nuestras unidades más solicitadas para estudio y trabajo; es uno de los mejores modelos que nos han llegado."

No afirmar datos falsos.

Si el cliente compara dos equipos específicamente:
comparar características, no stock.

==================================================
9. STOCK EXACTO
==================================================

No revelar normalmente la cantidad exacta en stock.

Si pregunta cuántas quedan:
responder que aún existen unidades disponibles.

Si insiste:
explicar que el sistema comercial trabaja principalmente con disponibilidad.

EXCEPCIÓN:

Si el SKU exacto tiene stock = 1:

agregar al FINAL DEL TEXTO DE CARACTERÍSTICAS:

🔥 ÚLTIMA UNIDAD DISPONIBLE

No enviar como mensaje separado.

==================================================
10. AUDIOS
==================================================

Inspeccionar todos los audios reales dentro de:

resources/Audios/

Los audios son respuestas oficiales.

Audio Comercial 1:
SIEMPRE después de:
foto → video → características.

Audio Comercial 2:
SIEMPRE después de presentar las agencias y pedir selección.

Los demás audios son la PRIMERA RESPUESTA cuando la intención correspondiente aparece.

Categorías existentes incluyen, entre otras:

- Comercial 1
- Comercial 2 / agencias
- Ubicación
- Contraentrega / confianza
- Reserva
- Open Box
- Envíos / Servientrega
- Garantía
- Delivery Guayaquil
- Qué incluye iPad
- Qué incluye MacBook
- Qué incluye Windows <= $100
- Qué incluye Windows > $100

Usar los nombres reales existentes.

Si el cliente repite la misma pregunta después del audio:
NO volver a enviar automáticamente el mismo audio.
Responder por texto basándose en el contenido del audio.

Si dice:
"no me mande audios"
"no puedo escuchar"
"escríbame"
o equivalente:

guardar durante esa conversación:

prefiere_texto = true

y usar transcripción/texto fiel de los audios.

Nunca contradecir el contenido de un audio oficial.

==================================================
11. QUÉ INCLUYE WINDOWS
==================================================

Todos tienen 6 meses de garantía.

Windows incluye:
- cargador original;
- audífonos;
- Office instalado y activado;
- obsequio sorpresa;
- microSD.

Regla actual:

precio SKU <= $100:
microSD 128 GB.

precio SKU > $100:
microSD 256 GB.

La microSD es almacenamiento externo.
NO describirla como almacenamiento interno.

El obsequio sorpresa NO se revela anticipadamente.

==================================================
12. QUÉ INCLUYE MACBOOK
==================================================

- cargador original;
- audífonos de obsequio;
- Office instalado y activado;
- 6 meses de garantía.

==================================================
13. QUÉ INCLUYE IPAD
==================================================

- cargador;
- audífonos;
- 6 meses de garantía.

==================================================
14. WINDOWS: REGLAS GENERALES
==================================================

Las configuraciones de 12", 14" y táctiles comparten como base comercial:

- 4 GB RAM;
- 16 GB almacenamiento interno;
- Intel Celeron;
- Windows 10 Pro.

Si preguntan específicamente por año:
responder según la política establecida: 2024.

Autonomía Windows:
aprox. 4 a 6 horas.

Puertos y funciones conocidas para computadoras:
- cámara;
- Bluetooth;
- Wi-Fi;
- HDMI;
- USB;
- entrada de audífonos.

NO inventar múltiples puertos.

Ejemplo:
si pregunta "¿tiene 5 HDMI?"
y solo corresponde uno,
responder positivamente sin mentir:
"Este modelo cuenta con un puerto HDMI..."

Las respuestas técnicas deben favorecer la venta, pero NUNCA alterar las características reales ni prometer algo inexistente.

==================================================
15. MACBOOK
==================================================

Las variantes cambian principalmente por:
- Core;
- RAM;
- almacenamiento;
- pulgadas.

No decir espontáneamente el año.

Si preguntan por el año:
usar la política comercial disponible.

Sistema:
usar la información oficial existente/configurada.

Autonomía:
aprox. 6 a 8 horas.

Color:
plateado.

Teclado iluminado:
sí, según política comercial definida.

==================================================
16. IPAD
==================================================

Autonomía:
aprox. 4 a 6 horas.

Color actual:
plateado.

No afirmar HDMI físico universal.

==================================================
17. PREGUNTAS TÉCNICAS ESPECÍFICAS
==================================================

La IA SÍ puede responder por sí sola preguntas de bajo riesgo como:

- HDMI;
- puertos;
- botones;
- Bluetooth;
- Wi-Fi;
- RAM;
- almacenamiento;
- procesador;
- tamaño;
- software;
- Office;
- clases;
- estudio;
- trabajo;
- Zoom;
- programación;
- compatibilidad básica;
- diferencias entre modelos.

Regla:
la respuesta debe favorecer comercialmente la venta,
PERO nunca mentir,
nunca cambiar especificaciones,
nunca prometer rendimiento no demostrado.

Para software exigente:
no garantizar resultados absolutos si depende de requisitos.

Puede orientar hacia equipos de mayor capacidad.

==================================================
18. MULTIMEDIA ESPECÍFICA
==================================================

El código debe poder conocer qué multimedia corresponde a cada SKU.

Más adelante habrá una base/ficha de qué se muestra en cada video.

Mientras tanto:

Si el cliente pide una foto/video MUY específico que no existe en recursos:
ESCALAR.

Antes de escalar, revisar si el video ya enviado contiene lo solicitado.

Si sí:
indicar que puede observarlo en el video enviado.

==================================================
19. SERVIENTREGA / ECUADOR
==================================================

Existe:

resources/Ecuador/

Contiene:
24 provincias
→ ciudades
→ HTML con agencias disponibles.

También existen archivos de alias/manifiesto.

Usarlos.

La búsqueda de agencias se basa principalmente en CIUDAD.

Provincia se usa cuando haga falta desambiguar.

Si ya conocemos la ciudad:
NO volver a preguntarla.

Regla de presentación:

si cantidad de agencias <= 15:
generar/usar IMAGEN clara a partir del HTML real.

si cantidad de agencias > 15:
generar/usar PDF.

NO inventar agencias.

NO usar recortes arbitrarios.

Después:
Audio Comercial 2.

==================================================
20. GUAYAQUIL
==================================================

Guayaquil permite dos opciones:

A) DELIVERY
B) CONTRAENTREGA EN SERVIENTREGA

Delivery:
- puntos/malls habilitados;
- horario lunes a viernes 10:00–18:00;
- puede revisar y probar el equipo antes de pagar;
- pago en efectivo o transferencia.

Si está fuera del horario o ya no da tiempo:
ofrecer programar delivery para el siguiente día disponible.

Si no puede por horario:
ofrecer contraentrega Servientrega.

Fuera de Guayaquil:
NO ofrecer delivery a domicilio.
Contraentrega en agencia.

==================================================
21. DELIVERY GUAYAQUIL - AUDIO
==================================================

Usar el audio real existente en resources/Audios/.

Su contenido explica:
- delivery en puntos habilitados;
- horario;
- revisión/prueba antes de pagar;
- efectivo/transferencia;
- alternativa de Servientrega;
- malls habilitados.

==================================================
22. ENVÍOS
==================================================

Envíos a nivel nacional por Servientrega.

Promo oficial actual:
ENVÍO GRATIS.

Tiempo después del despacho:
24–48 horas aproximadamente.

No prometer hora exacta.

Si pregunta:
"¿me garantiza mañana a las 10?"

explicar:
24–48h y depende del operador logístico.

==================================================
23. REVISIÓN ANTES DE PAGAR EN SERVIENTREGA
==================================================

Política:

Level Up Store sí autoriza que el paquete pueda ser abierto/revisado.

Pero cada agencia Servientrega puede manejar políticas operativas distintas.

NO garantizar que todas las agencias lo permitirán.

==================================================
24. SEGURIDAD: VIDEOS DE FUNCIONAMIENTO Y EMPAQUE
==================================================

Después de que el humano/logística tome el pedido,
antes del envío,
se generan dos videos:

1. funcionamiento/prueba;
2. empaque/accesorios/guía.

Estos son FUERA DEL BOT AUTOMÁTICO.

Si el cliente pregunta durante venta por seguridad,
se puede explicar que antes del envío recibirá videos donde se muestra:
- funcionamiento;
- estado;
- accesorios;
- empaque;
- guía.

El número de guía es único y sirve para comprobar que corresponde al paquete mostrado.

==================================================
25. DATOS
==================================================

Antes de la confirmación recopilar:

- nombre completo;
- cédula;
- teléfono = número de WhatsApp;
- ciudad;
- provincia cuando corresponda;
- agencia o mall;
- producto;
- variante;
- cantidad.

Si el cliente manda varios datos en un solo mensaje:
capturarlos inmediatamente.

NO volver a pedir información que ya proporcionó.

==================================================
26. FACTURA / IVA
==================================================

NO escalar.

Respuesta oficial:

Si desea factura:
se agrega 15% por IVA.

Si no desea factura:
se mantiene el precio mostrado.

Implementar según esta política comercial proporcionada.

==================================================
27. DESCUENTOS / MAYORISTA
==================================================

El bot NO calcula descuentos.

Los precios oficiales salen de stock.

Si pregunta por descuento para una sola unidad:
explicar que los precios son oficiales.

Si compra más de una unidad:
puede existir descuento.

ANTES DE ESCALAR, recopilar:
- producto(s);
- modelo(s);
- cantidad;
- variantes;
- si son iguales o productos variados.

Precio mayorista:
igual.

NO existe tabla fija.

Cuando ya se tiene información suficiente:
PAUSAR EL CHAT Y ESCALAR AL HUMANO.

NO mandar al cliente:
"un asesor lo contactará"
"voy a consultar"
etc.

Simplemente pausar después de recopilar lo necesario.

==================================================
28. OTRAS NEGOCIACIONES
==================================================

Si pide:
- precio especial;
- garantía extra a cambio de compra;
- condiciones especiales;
- paquete negociado;
- descuento condicionado;

recopilar información necesaria
→ pausar
→ humano.

==================================================
29. ESCALAMIENTO
==================================================

NO existe comando RESPONDER en esta versión.

Cuando se escala:
- chat queda completamente pausado;
- el bot deja de responder;
- aunque el cliente siga mandando mensajes, no responde;
- humano toma control.

Casos principales de escalamiento:

- descuento/mayorista/negociación;
- multimedia específica inexistente;
- contradicción entre fuentes;
- reclamo/postventa.

==================================================
30. RECLAMOS
==================================================

Después de una liberación, el número puede volver a escribir.

Si la IA detecta que viene por:
- reclamo;
- garantía real;
- falla del producto;
- devolución;
- problema postventa;
- incidencia de compra anterior;

PAUSAR INMEDIATAMENTE.

NO RESPONDER.

Humano atiende.

==================================================
31. GARANTÍA
==================================================

Primera pregunta general:
enviar Audio Garantía.

Si pide más detalle:
texto resumido.

Política:

- 6 meses;
- cubre fallas propias del equipo dentro del periodo;
- cubre que deje de funcionar;
- cubre fallas de funciones/sistema cuando corresponda;
- si aplica, cambio por otro equipo igual/equivalente;
- NO decir "nuevo";
- daños provocados por cliente: no;
- golpes posteriores al cliente: no;
- caídas/humedad/mal uso: no;
- pérdida/robo: no;
- expectativas estéticas/personales: no;
- daños de transporte que afecten funcionalidad: se atienden;
- rayones/golpes leves de transporte que no afectan funcionamiento no generan cambio automático.

Un reclamo real POSTVENTA pausa el bot y pasa a humano.

==================================================
32. RESERVA
==================================================

Reserva = $20.

NO saltarse flujo por pedir reserva.

Primero:
producto
→ variante
→ multimedia
→ ubicación
→ agencia/delivery
→ datos
→ resumen
→ confirmación.

Condiciones:
- vigencia 14 días;
- $20 no reembolsables;
- se descuentan del precio final;
- cubren almacenamiento/mantenimiento;
- cliente coordina envío dentro de 14 días;
- si se envió y no retiró, segundo envío puede generar costo;
- pago de reserva por transferencia.

Audio Reserva explica condiciones.

Después de confirmación:
PAUSAR.

El humano envía datos bancarios y verifica la reserva.

El bot NO envía cuentas bancarias.

==================================================
33. CONFIRMACIÓN
==================================================

La confirmación la interpreta OpenAI/IA semánticamente.

NO usar solo lista rígida de palabras.

Aceptar lenguaje natural, audio transcrito, emoji claro, etc.

Pero:
negación/corrección tiene prioridad.

Ejemplo:

"Sí, pero mi cédula termina en 8"

NO es confirmación final.

Actualizar dato
→ volver a mostrar resumen
→ volver a solicitar confirmación.

Si es ambiguo:
preguntar nuevamente de forma breve.

Ejemplo:

"Disculpe, estimado/a. Solo para confirmar, ¿los datos de su pedido están correctos y desea que procedamos con el envío?"

==================================================
34. RESUMEN DE PEDIDO
==================================================

Crear un resumen claro que incluya:

- nombre;
- cédula;
- teléfono;
- ciudad;
- provincia si aplica;
- agencia/mall;
- producto;
- variante;
- cantidad;
- precio/unitario;
- total.

El precio siempre de stock,
salvo un descuento explícitamente aprobado por humano.

==================================================
35. HORARIOS DE DESPACHO
==================================================

Lunes a viernes:

corte = 17:00.

Si confirma antes de 17:00:
se puede decir que se procesa para despacho ese día.

Después de 17:00:
se procesa para siguiente día operativo.

Sábado:
corte = 11:00.

Después de 11:00:
siguiente despacho = lunes.

Domingo:
siguiente despacho = lunes.

No afirmar que ya se envió antes de que logística lo haga.

Usar lenguaje:
"proceder con el envío"
"procesar para despacho"

Llegada estimada:
24–48h después del despacho.

==================================================
36. RESPUESTA HUMANA / NATURALIDAD
==================================================

No responder instantáneamente siempre.

Antes de respuestas automáticas:
- marcar leído;
- activar typing/escribiendo;
- esperar tiempo natural.

Máximo aproximado:
20 segundos.

Respuestas muy simples:
menos.

Consultas más complejas:
más.

Bloques multimedia:
una espera antes de iniciar el bloque,
luego pausas cortas entre elementos.

NO esperar 20 segundos entre foto/video/texto/audio.

==================================================
37. ESTADOS DE PAUSA
==================================================

Necesitamos al menos:

ACTIVE
PAUSED_CONFIRMED
PAUSED_ESCALATION
PAUSED_CLAIM

Mientras paused:
NO responder automáticamente.

==================================================
38. COMANDOS ADMIN
==================================================

Solo mantener DOS comandos:

/liberar +593XXXXXXXXX

/borrar +593XXXXXXXXX

Acepta de forma práctica variaciones razonables de mayúsculas/minúsculas y espacios.

El número oficial debe normalizarse a formato:
+593...

/liberar:
- QUITA LA PAUSA;
- NO borra memoria;
- permite que la IA revise el contexto existente y continúe si corresponde.

/borrar:
- borra TODA la memoria/estado/contexto de ese chat;
- limpia producto, etapa, datos, preferencias, audios enviados, etc.;
- además deja el chat LIBERADO/ACTIVO;
- próximo mensaje = conversación desde cero.

NO mantener:
RESPONDER
GUIA
LLEGO
RETIRADO
CANCELADO
PAGO
IR
etc.

==================================================
39. BORRADO AUTOMÁTICO 30 DÍAS
==================================================

Mantener limpieza automática.

Si una conversación permanece con información vieja durante 30 días:
- borrar memoria;
- borrar contexto comercial;
- borrar estado;
- si estaba pausada, liberarla.

Resultado:
número limpio y activo para nueva compra.

==================================================
40. MEMORIA MÍNIMA
==================================================

Durante una conversación activa conservar como mínimo:

- phone canonical;
- stage;
- product;
- sku;
- variant;
- qty;
- city;
- province;
- agency/mall;
- name;
- cedula;
- phone;
- prefersText;
- sentAudios;
- handledIntents;
- reserveIntent;
- pauseState;
- timestamps;
- lastInteraction.

No pedir nuevamente datos ya conocidos.

==================================================
41. COSAS QUE YA NO HACE EL BOT
==================================================

Eliminar/desactivar lógica vieja relacionada con:

- GUIA;
- LLEGO;
- RETIRADO;
- CANCELADO;
- seguimiento automático de retiro;
- seguimiento postventa;
- registro de ventas por comandos;
- control logístico posterior;
- cuadros de ventas;
- descuentos automáticos;
- PAGO;
- IR;
- RESPONDER;
- stock decrementado mediante comandos logísticos viejos.

No eliminar infraestructura compartida necesaria para YCloud, Sheets, memoria o pruebas si sigue siendo útil.

==================================================
42. COMPATIBILIDAD Y SEGURIDAD DE CAMBIOS
==================================================

Antes de modificar:
- identifica arquitectura actual;
- identifica rutas del webhook YCloud;
- identifica memoria;
- identifica Google Sheets;
- identifica pruebas existentes;
- identifica módulos obsoletos;
- identifica resources.

Haz cambios incrementales.

No destruyas integración funcional con YCloud.

No cambies secretos.

No imprimas tokens.

No incluyas credenciales.

==================================================
43. TESTS OBLIGATORIOS
==================================================

Crear pruebas para, como mínimo:

- greeting;
- iPad flow;
- Windows flow;
- MacBook flow;
- recommendation highest stock;
- tie recommendation;
- exact SKU selection;
- stock 1 → última unidad;
- multimedia order = foto/video/características/audio;
- audio first response;
- repeated question → text;
- prefers text;
- city remembered;
- agencies <=15 image;
- agencies >15 PDF;
- Guayaquil delivery;
- Guayaquil contraentrega;
- outside Guayaquil no domicilio;
- data extraction in mixed messages;
- confirmation semantic positive;
- confirmation ambiguous;
- correction beats confirmation;
- before/after 17:00;
- Saturday cutoff 11:00;
- Sunday → Monday;
- reservation;
- discount escalation;
- wholesale escalation;
- multimedia-specific escalation;
- contradiction escalation;
- claim → pause/no response;
- paused chat ignores inbound;
- /liberar resumes;
- /borrar clears + activates;
- auto purge 30 days;
- no old admin commands;
- no sales/logistics writes after confirmation;
- stock/prices from Sheet;
- no cross-SKU characteristics;
- phone normalization Ecuador.

==================================================
44. REVISAR RESOURCES
==================================================

Inspecciona físicamente la carpeta resources.

Genera si resulta útil un manifiesto interno de:

SKU
→ images
→ videos

y:

intent
→ audio file

y:

city
→ agency HTML.

No cambiar los nombres de SKU.

No alterar archivos multimedia originales.

==================================================
45. RESULTADO FINAL DE TU TRABAJO
==================================================

NO PUSH.
NO DEPLOY.

Al terminar quiero un informe con:

A. Resumen de arquitectura encontrada.
B. Archivos modificados.
C. Archivos nuevos.
D. Funciones eliminadas/desactivadas.
E. Cómo funciona el nuevo state machine.
F. Cómo se leen productos/precios/stock.
G. Cómo se resuelve multimedia.
H. Cómo se resuelven agencias.
I. Cómo se utilizan audios.
J. Cómo funcionan /liberar y /borrar.
K. Cómo funciona el purge de 30 días.
L. Tests nuevos.
M. Resultado de npm test.
N. Resultado de cualquier suite V2/V2.5 existente.
O. Resultado de lint/check si existe.
P. Riesgos o contradicciones encontradas.
Q. Lista exacta de pasos para realizar una prueba real por WhatsApp.

Si una suite antigua falla porque prueba comportamiento intencionalmente eliminado, NO ocultes el fallo:
- identifica la prueba;
- explica por qué ya no aplica;
- actualízala/elíminala solamente si realmente corresponde a la especificación nueva.

OBJETIVO FINAL:

Un bot mucho más ligero que venda correctamente desde primer contacto hasta confirmación, use respuestas/audios aprobados, consulte stock real, use multimedia real, maneje agencias, responda dudas técnicas controladas y entregue el chat al humano después de confirmar o escalar.

EMPIEZA AHORA AUDITANDO EL REPOSITORIO Y LOS RESOURCES.
DESPUÉS IMPLEMENTA.
AL FINAL PRUEBA TODO.
NO HAGAS PUSH NI DEPLOY.