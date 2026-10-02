# Informe V3 final — 2026-10-01

## A. Archivos modificados en esta iteración

- `.env.example`: override opcional de malls y fuente de hechos visuales.
- `server.js`: lista aprobada central; hechos cargados desde recursos reales.
- `lib/v2-agencies.js`: fuente local con fallback incluido.
- `lib/sales-resources.js`: carga de facts verificados.
- `lib/sales-flow.js`: registro del archivo/hash enviado y respuestas visuales verificadas.
- `lib/sales-interpreter.js`: identifica canAnswer exacto sin ampliar lo que la evidencia demuestra.
- `scripts/audit-sales-resources.js`: fuente efectiva, cobertura de facts e incompatibilidades visuales.
- `scripts/test-sales.js`: expectativas de TXT actuales y seis pruebas adicionales.
- `docs/resources-manifest.json`: regenerado desde los archivos físicos actuales.

Esta lista describe cambios respecto a V3 al comenzar esta iteración; el diff general de Git contiene también trabajo V3 previo y el reemplazo de recursos efectuado por el usuario.

## B. Archivos creados

- `lib/sales-malls.js`
- `lib/agency-font.js`
- `lib/assets/fonts/NotoSans.ttf`
- `lib/assets/fonts/OFL.txt` (licencia de la fuente)
- `lib/sales-media-facts.js`
- `resources/media-facts.json`
- `docs/media-facts.md`
- `docs/INFORME-V3-FINAL.md`

## C. Malls operacionales

- Mall del Sol
- San Marino Shopping
- Policentro
- CityMall
- Mall del Norte
- Riocentro Norte
- Riocentro Ceibos
- Albán Borja
- Riocentro El Dorado
- Village Plaza
- Riocentro Entre Ríos

La lista central en `lib/sales-malls.js` es el valor por defecto. DELIVERY_MALLS_JSON permite un subconjunto u orden diferente de los puntos aprobados; nombres no aprobados generan error explícito. `[]` deshabilita delivery deliberadamente y conserva la pausa existente. No existe override de malls en el .env local revisado; no se modificó ese archivo.

Mall del Sur, Riocentro Sur, Mall El Fortín y cualquier centro de Durán quedan fuera de la lista permitida. Se mantienen horario lunes–viernes 10–18, revisión antes de pago en efectivo/transferencia, programación al siguiente día operativo fuera de horario y alternativa Servientrega. Las condiciones comerciales de delivery y la fecha se preservan en el cierre. Solo se ofrece este modo cuando la ciudad seleccionada es Guayaquil, conforme a V3.

## D. Corrección de PNG

Se conservó el diseño y la paginación existentes. El renderer usa `resources/fonts/NotoSans.ttf` si existe; en esta estructura usa la misma fuente Noto Sans incluida en `lib/assets/fonts`, recuperada del repositorio y acompañada por su licencia OFL. No depende de fuentes del sistema operativo ni descargas o copias manuales. Esto permite el mismo render en Linux/Render. Si el fallback falta por un paquete incompleto, falla explícitamente en vez de generar texto invisible.

Pruebas con 1 y 15 agencias decodifican las filas PNG y cuentan píxeles oscuros en el cuerpo (más de 1000), además de verificar formato y dimensiones. Se inspeccionó visualmente un PNG real de Babahoyo con sus ocho agencias. Más de 15 conserva PDF, con comprobación de los 16 nombres completos y estructura PDF. No se modificó el constructor PDF.

## E. Resultado de media-facts

Todos los archivos tienen nombre, tipo, SHA-256, shows, visibleDetails, canAnswer, notVisible y método de inspección. Los videos registran duración y los 24 segundos muestreados. Se revisaron 27 contenidos únicos: 17 fotos y 10 videos, reutilizando facts cuando el hash es idéntico. No se exigió material diferente para cada variante.

MacBook: se registran exterior frontal, teclado, pantalla, touchpad y Word cuando están visibles. Los videos generales no prueban RAM/almacenamiento exactos ni autonomía ni funcionamiento de puertos. Windows conserva diferencias ASUS/Acer/HP/Dell/Lenovo, Excel y accesorios solo donde están visibles; los empaques no sustituyen políticas oficiales. iPad: el video muestra tablet, interacción táctil, Word/Excel y parte trasera; las fotos son incompatibles y no autorizan respuestas visuales de iPad.

El bot conserva foto → video → características → Comercial 1. Solo remite al material enviado con nombre/tipo/hash coincidente y pregunta registrada; un dato no demostrado sigue el escalamiento existente. Para memoria de una presentación anterior a esta actualización sin registro de hash, no se inventa evidencia enviada. STOCK sigue siendo la fuente de especificaciones exactas, precios y disponibilidad. No se usa publicidad como stock.

## F. Fotos/videos descritos y agencias

- 32 SKU; 57 fotos y 30 videos, 87 registros cargados.
- Ningún recurso supera 5 MiB para imagen o 16 MiB para video; los tres MacBook 15 corregidos están dentro del límite y sus videos fueron decodificados para inspección.
- Solo IMAC2011-250 e IMAC2012-250 carecen de foto y video; se dejaron intactos y conservan la lógica de multimedia ausente.
- 24 provincias, 233 ciudades/HTML y 679 agencias; sin errores del parser.
- Ruta efectiva: `resources/Ecuador`; los 234 archivos del manifiesto geográfico coinciden por SHA-256.

El detalle por SKU y rutas originales permanece en `docs/resources-manifest.json` y `docs/media-facts.md`.

## G. Audios + TXT

14 M4A y 14 TXT contiguos con nombre base idéntico, todos no vacíos, sin mapeos ambiguos o ausentes. Los TXT se leen literalmente, con trim de espacios externos; no se generaron ni corrigieron transcripciones. Primera intención usa audio oficial; repetición/prefersText conserva uso del TXT correspondiente.

- `Audio Contraentrega - confianza.m4a` → `trust`
- `Audio Delivery Guayaquil oficial.m4a` → `delivery`
- `Audio Envíos - Servientrega.m4a` → `shipping`
- `Audio Garantía.m4a` → `warranty`
- `Audio Open Box — estado del equipo.m4a` → `openbox`
- `Audio Reserva.m4a` → `reserve`
- `Audio ¿Qué incluye? — MacBook.m4a` → `macbook`
- `Audio ¿Qué incluye? — Windows $100.m4a` → `windowsLow`
- `Audio ¿Qué incluye? — Windows superior a $100.m4a` → `windowsHigh`
- `Audio ¿Qué incluye? — iPad.m4a` → `ipad`
- `Audio ¿Qué incluye?.m4a` → `includes`
- `Comercial 1.m4a` → `commercial1`
- `Comercial 2-agencias.m4a` → `commercial2`
- `Ubicación.m4a` → `location`

## H. Tests finales

| Comando | Resultado |
| --- | --- |
| `npm run audit:resources` | OK: 32 SKU, 14 audios/TXT, 57 fotos, 30 videos, 24 provincias, 233 HTML/ciudades, 679 agencias; fuente disponible; sin excedentes de tamaño |
| `npm run test:sales` | 81/81 aprobadas; cero fallos u omisiones |
| `npm test` | 681 pruebas: 680 aprobadas, cero fallos, 1 omitida |
| `npm run check` | Sintaxis válida de 34 archivos |
| `git diff --check` | OK, sin errores de whitespace |

La única omisión es la prueba histórica de aislamiento del sistema operativo, no compatible con este host. No es una omisión comercial. Las suites prueban iPad, Windows, MacBook, recomendaciones, delivery/contraentrega Guayaquil, fuera de Guayaquil, orden de presentación, confirmación semántica y correcciones, pausa, /liberar, /borrar y purga de 30 días. Se añadieron pruebas de malls/exclusiones/Durán, PNG visible/PDF, carga e integridad de facts y 14 pares audio/TXT.

Todas las integraciones usadas por las pruebas fueron simuladas. No se consultaron Sheets reales ni se enviaron mensajes a WhatsApp para esta verificación.

## I. Pendientes reales

1. Diez fotos en los cinco SKU IPADAIR1-16-BLA, IPADAIR1-16-PLA, IPADAIR1-32-BLA, IPADAIR1-32-PLA e IPADAIR2-16-PLA muestran un portátil Dell. Deben reemplazarse por material correspondiente antes de una prueba comercial completa de iPad. Esta iteración no sustituyó esos recursos ni cambió el comportamiento de multimedia ausente.
2. Realizar la prueba real autorizada en un entorno/número de prueba y validar lectura de PAGINA DE STOCK/MEMORIA, interpretación semántica y recepción efectiva de medios. Las pruebas locales no acreditan esa integración en vivo.
3. iMac sin multimedia queda como decisión aceptada, fuera del cierre de esta iteración, sin bloquear pruebas de las demás familias.

No quedan pendientes de malls, fuente PNG, PDF, mapeo audio/TXT o tamaño de videos MacBook 15. No se inventó evidencia de capacidades exactas ni funcionamiento no mostrado.

## J. Estado para prueba real WhatsApp

Código V3 listo para una prueba controlada de Windows/MacBook y del flujo comercial con integraciones de prueba configuradas. No corresponde declarar todo el catálogo listo sin salvedades: las fotos incorrectas de los cinco iPad siguen siendo un pendiente real de recursos. Se puede probar el flujo de iPad de forma interna teniendo presente esta incidencia, pero no presentar esas fotos como evidencia del producto.

No hubo push, deploy, llamadas a producción, cambios de secretos ni cambios del número Meta anterior. No se reactivó logística ni comandos antiguos. No se tocaron las carpetas iMac.
