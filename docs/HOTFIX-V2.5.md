# HOTFIX V2.5 — revisión local

Base: f63cf29. No se hizo deploy, push, operación en Render, cambio de credenciales,
envío real ni escritura real en Sheets. Se conservaron las reglas operativas V2.5.

## A. Causa raíz de cada fallo

| Fallo | Causa encontrada en código | Corrección |
| --- | --- | --- |
| Saludo mostraba catálogo | Sin rama de saludo, el fallback sin selección enumeraba todas las variantes | Saludo local antes del clasificador/catálogo |
| Conversación rígida/etapas | Las preguntas competían con clasificación de confirmación y captura | Prioridad a consultas concretas; conservar etapa y resumen |
| Introducción técnica en audio | Texto literal de AudioComercial1 | Sustituido por contenido comercial aprobado, sin presentación técnica |
| Variante/ficha | Cambio de selección no renovaba la presentación y no comprobaba contradicciones explícitas en G | Ficha, precio y media por SKU exacto; refrescar al cambiar y escalar G contradictoria |
| Fotos/video ignorados | No existía rama de solicitud multimedia; terminaba en captura/consulta genérica | Fotos/video del SKU solicitado, sin avanzar etapa |
| Agencias fragmentadas/duplicadas | Loop de cards individuales más listado textual | Imagen completa o páginas numeradas de bloques completos; sin lista duplicada |
| Quito la Asunción no coincidía | Comparación de cadenas sin quitar artículos/preposiciones | Matching de tokens normalizados y resultado único |
| Datos se perdían ante pregunta | Ramas de preguntas retornaban antes de extracción/persistencia de datos | Captura escrita primero y guardado inmediato, incluso con mensajes agrupados |
| Entrega ordinaria escalaba | Consulta no tenía regla operativa específica | Respuesta 24–48 horas después del despacho; excepcional/exacta se escala |
| RESPONDER con +/09 fallaba | Regex no aceptaba +; búsqueda por clave literal y creación implícita de conversación vacía | Parser estricto, teléfono canónico y búsqueda de una única fila existente |
| Promociones/resumen repetidos | Faltaban marcadores en presentación/reemisión | Conservar conceptos comunicados y fingerprint de resumen, sin confirmar un envío fallido |

La contradicción 16/32 GB observada no puede atribuirse a una celda real concreta
sin leer la hoja de producción. No se leyó esa hoja. Los tests verifican filas
correctas por SKU y rechazo de una ficha G que contradiga la capacidad seleccionada.

## B. Archivos modificados

Nuevos:
- lib/v2-commercial-input.js: saludo, solicitudes, captura escrita y validación de ficha.
- scripts/test-v25-hotfix.js: 44 regresiones del hotfix.
- docs/HOTFIX-V2.5.md: este informe.

Modificados:
- server.js: prioridad de preguntas/admin, resolución telefónica y logs seguros.
- lib/v2-admin-commands.js: RESPONDER con + y normalización ecuatoriana.
- lib/v2-commercial-flow.js: preguntas primero, datos persistidos, ficha exacta,
  presentación comercial, resumen sin repetición y agencias consolidadas.
- lib/v2-product-media.js: tipo solicitado y dedup por solicitud explícita.
- lib/v2-agencies.js: matching natural y render de páginas completas con caché acotada.
- package.json: nueva suite incluida en npm test/test:v2.
- SPEC.md y README.md: contrato corregido.

Sin cambios a inventario, comandos logísticos, transporte YCloud/Meta, STT,
credenciales, recursos originales ni estructura de Sheets.

## C. Cambios realizados

- Saludos naturales sin catálogo/modelo. OpenAI permanece para interpretación
  ambigua y evidencia de catálogo; no controla estados, precios o inventario.
- Ficha exacta de variante y audio comercial directo; respuestas largas usan el
  servicio TTS existente, mensajes críticos/precios/resúmenes siguen por texto.
- Solicitudes explícitas pueden reenviar fotos/video, una vez por mensaje;
  conservan SKU, datos y etapa. Sin URL inventada ni producto agotado.
- Ciudad única infiere provincia. Agencias se presentan sin crops ni lista doble.
  Quito real tiene 144 agencias: 12 páginas numeradas con el tamaño legible usado.
  Primera página revisada visualmente. Caché de cuatro ciudades por contenido.
- Captura local de nombre/cédula clara antes de preguntas; extracción existente
  para los demás casos. Sin checksum. Resumen idéntico no se repite.
- RESPONDER (+593…), (593…) y (09…) comparan dígitos canónicos 593…; se conserva
  la clave encontrada en MEMORIA, incluida una clave con +. Dos filas alias son
  ambiguas y no se elige una. CH mantiene su semántica y takeover real se respeta.
- Respuesta puntual se agrega al historial y marca resuelta, elimina pregunta y
  respuesta pendientes y deja intactos etapa/SKU/agencia/datos. No fuerza takeover.
- Logs de etapa/regla/SKU/media/ciudad validada/matching, datos guardados booleanos
  y progreso del comando; no contenido, cédulas, teléfonos ni URLs completas.

## D. Tests nuevos

44 casos: saludos, catálogo relevante, variantes 16/32 y cambios, fotos/video,
audio sin preámbulos técnicos, TTS/precios, imágenes completas/paginación,
matching Asunción y ambigüedad, provincia posterior, captura antes de pregunta,
entrega y escalamiento, teléfonos con/sin + y local contra ambas claves MEMORIA,
CH/takeover, admin inválido, TTS de RESPONDER, dedup, reinicio, privacidad de logs,
multimedia solicitada, promoción y ficha contradictoria.

Los tests existentes se conservaron; se corrigieron los fallos de implementación
que aparecieron en la regresión, sin eliminar ni relajar sus aserciones.

## E. npm test

Base: 555 passed / 0 failed / 1 skipped (556 total).
Hotfix: 599 passed / 0 failed / 1 skipped (600 total).
Skip heredado: aislamiento opcional del sistema operativo no disponible.
Mocks de modelos, proveedores y Sheets; ningún mensaje o acceso real.

## F. npm run test:v2

386 passed / 0 failed / 0 skipped. Subconjunto del total anterior.

## G. npm run check

OK: 25 archivos.

## H. git diff --check

OK.

## I. Riesgos restantes

- Ficha G incoherente requiere corrección humana en origen; el bot no inventa
  su sustitución. Solo se detectan contradicciones explícitas de almacenamiento,
  no se garantiza validación semántica universal de todos los campos de G.
- Ciudades grandes generan varias páginas. El primer render consume CPU; la
  caché evita repeticiones. Verificar compresión/legibilidad en WhatsApp real.
- Filas duplicadas de MEMORIA con alias equivalentes requieren reconciliación;
  se bloquea la selección ambigua en vez de arriesgar otra conversación.
- Mantienen vigencia las deudas previas: una instancia, dedup Meta parcialmente
  en RAM, reconciliación de entregas inciertas, plantillas >24h, conciliación de
  descuentos con fórmulas y verificación de codecs reales.
- Una presentación de varios mensajes no es transacción con el proveedor;
  una interrupción puede dejarla parcial. No se promete exactly-once externo.

## J. Recorrido exacto para repetir en WhatsApp

En un entorno controlado y con números internos autorizados, después de revisión:

1. Enviar «Hola qué tal»: esperar saludo, sin catálogo.
2. Pedir iPad: ver solo variantes iPad; seleccionar 16 GB y comprobar ficha,
   fotos, precio y audio directo. Cambiar a 32 y regresar a 16; cotejar SKU/G.
3. Preguntar «¿Tiene fotos?» y «¿Tiene video?»: recibir media correcto sin que
   avance a otra etapa ni cambie el producto.
4. Enviar «Soy de Quito», después «Pichincha»: no repetir provincia ni imágenes.
   Revisar páginas completas y ausencia de lista duplicada por texto.
5. Elegir «Quito la Asunción»; repetir en ciclo limpio con «la de Asunción».
6. Enviar nombre y cédula seguidos rápidamente de «¿En qué tiempo me llega?»:
   esperar 24–48h posteriores al despacho y resumen con datos guardados,
   sin nueva solicitud de nombre/cédula.
7. Hacer una pregunta sin respuesta fiable: comprobar aviso breve y alerta al
   asesor. Probar RESPONDER con +593, 593 y 09, siempre con paréntesis; verificar
   texto corto/audio largo, historial, reanudación y ausencia de duplicados.
8. Enviar RESPONDER sin paréntesis y texto libre del admin: silencio.
9. Reiniciar entorno de prueba entre captura/pregunta/respuesta; verificar
   persistencia de SKU, agencia, datos y etapa.
10. Confirmar, comprobar CH/LU únicos, cierre/logística y takeover; ejecutar el
    recorrido de humo GUIA→LLEGO→LIBERAR→RETIRADO para validar no regresión.

Estas pruebas reales no fueron ejecutadas. No desplegar ni hacer push como parte
de este hotfix. Cambios locales listos para revisión manual.
