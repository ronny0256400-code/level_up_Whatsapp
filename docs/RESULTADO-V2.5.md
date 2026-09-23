# Correcciones finales V2.5 — resultado local

No se hizo deploy, push, cambio de Render/credenciales/.env ni pruebas reales
contra clientes, OpenAI o Google Sheets. Rama main, cambios locales para revisión.
Se mantuvo el trabajo V2.5 anterior y se reutilizaron recursos del repositorio.

## A. RESUMEN DE CAMBIOS

Eliminado todo comportamiento monetario especial del runtime: cálculo,
confirmación y GUIA aceptan cualquier importe representable con stock suficiente.
No se purgan IDs/datos ni se requiere excepción de LIBERAR por teléfono.

Confirmación: texto breve «✅ Pedido confirmado correctamente.» seguido de TTS
logístico con fecha calculada en Guayaquil. Outboxes independientes conservan
progreso y contenido; fallos previos a entrega permiten texto idéntico, resultados
inciertos quedan para reconciliación. Takeover sigue bloqueando el resto del chat.

RESPONDER usa TTS para explicaciones largas y texto para cifras/códigos/datos
precisos. Mensajes administrativos inválidos quedan silenciosos. Ofertas
manuales inequívocas quedan vinculadas al SKU/cantidad del pedido actual, con
resumen nuevo; no se propagan a otros chats ni cantidades.

Ciudades únicas infieren provincia, typo seguro, agencias por ordinal/referencia
segura, correcciones de producto/variante/cantidad, más aceptaciones locales,
respuesta aprobada de bodegas, alternativa de nube sin inventar memoria física,
marcador de promoción comunicada y conversación normal para compra futura.

## B. ARCHIVOS MODIFICADOS/NUEVOS

En esta corrección se agregaron lib/v2-final-rules.js y scripts/test-v25-final.js.
Se ajustaron server.js; lib/v2-policy.js, v2-inventory.js, v2-errors.js,
v2-tts.js, v2-agencies.js, v2-commercial-flow.js; package.json; el helper runtime;
tests de confirmación/flujo/venta/policy/runtime/V2.5; SPEC, README y migración.
El inventario siguiente incluye también el trabajo V2.5 previo aún sin commit.

### Archivos nuevos y función

| Archivo | Función |
| --- | --- |
| lib/v2-final-rules.js | Despacho determinístico, clasificación de respuesta y ofertas acotadas |
| scripts/test-v25-final.js | 60 pruebas de correcciones finales |
| lib/v2-admin-commands.js | Parser estricto y referencias |
| lib/v2-chat-id.js | Contador CH persistente y detección de colisiones |
| lib/v2-order-transitions.js | Retiro/cancelación centrales y recuperación |
| lib/v2-calendar.js | Ventanas, plazos y promociones |
| lib/v2-commercial-flow.js | Etapas del flujo comercial |
| lib/v2-language.js | Interpretación acotada a etiquetas/catálogo |
| lib/v2-agencies.js | HTML local, matching y cards PNG |
| lib/v2-product-media.js | Multimedia por SKU y ledger persistente |
| lib/v2-tts.js | Síntesis, formatos, temporales y fallback |
| lib/v2-outbox.js | Reserva durable y reintento seguro |
| lib/v2-sheet-migration.js | Diagnóstico de fórmulas, solo lectura |
| scripts/check-syntax.js | Validación sintáctica de server y lib |
| scripts/test-v25.js | Cobertura nueva V2.5 |
| scripts/fixtures/agencias/SERVIENTREGA.html | Agencias sintéticas para tests |
| docs/MIGRACION-V2.5.md | Procedimiento manual previo al despliegue |
| docs/RESULTADO-V2.5.md | Este informe |
| resources/agencias/Ecuador/** | 233 HTML importados |
| resources/productos/** | 6 fotos y 3 videos por SKU |
| resources/fonts/NotoSans.ttf, OFL.txt | Fuente y licencia para cards |

### Archivos existentes modificados

- `README.md`
- `SPEC.md`
- `lib/v2-errors.js`
- `lib/v2-commerce.js`
- `lib/v2-inventory.js`
- `lib/v2-policy.js`
- `lib/ycloud-client.js`
- `package-lock.json`
- `package.json`
- `scripts/helpers/v2-runtime.js`
- `scripts/test-admin-notice.js`
- `scripts/test-ciclo-administrativo.js`
- `scripts/test-confirmacion-deterministica.js`
- `scripts/test-confirmacion-guia.js`
- `scripts/test-flujo-progresivo.js`
- `scripts/test-v1.js`
- `scripts/test-v2-diagnostics.js`
- `scripts/test-v2-guia.js`
- `scripts/test-v2-inventory.js`
- `scripts/test-v2-policy.js`
- `scripts/test-v2-runtime.js`
- `scripts/test-venta-real.js`
- `scripts/test-ycloud-audio.js`
- `scripts/test-ycloud-webhook.js`
- `server.js`

Los tests anteriores se ajustaron a reglas sustituidas: sintaxis con paréntesis,
CH, selección de agencia antes de datos, multimedia comercial, retirado/cancelado
y confirmaciones determinísticas. No se eliminaron suites para obtener verde.

## C. REGLAS ELIMINADAS

- Límite monetario, derivación/purga por monto y error de límite en inventario.
- Cierre antiguo que solo prometía atención posterior del asesor.
- Obligación de texto para toda respuesta humana y todo bloque logístico.
- Aclaración innecesaria de provincia para ciudad única.

No hay handler ni autorización del comando descartado en el prompt. Su rechazo
se prueba explícitamente. PAGO sigue eliminado; DEVUELTO sigue siendo físico/manual.

## D. REGLAS NUEVAS/CORREGIDAS

- Despacho lunes-viernes hasta 17:00 inclusive; sábado hasta 11:00 inclusive.
  Evaluación por minuto civil. Después, siguiente día operativo; domingo → lunes.
- TTS conserva gpt-4o-mini-tts, cedar, 1.15, WAV→Opus; sin temporales permanentes.
- GUIA mantiene CH como referencia y paréntesis obligatorios; valida stock y
  precio actual antes del batch de todas las líneas. Confirmar no registra venta.
- Stock se calcula en Sheets. Backend escribe ventas B:O/S/V, estados F y retiro
  F/H. P/Q/R/T/U/W, DATOS!P y RE-STOCK permanecen intactos.
- Cédula sin validación matemática/legal. Administrador revisa antes de GUIA.
- Tres días laborales, seguimiento 4h y comercial 48/96h permanecen; 72h no
  ejecuta el segundo followup. No se agregó reserva ni seguimiento de fin de mes.
- Postventa, bloqueo de segunda compra, audio entrante máximo tres minutos,
  dedup, guardas y avisos administrativos por proveedor permanecen.

## E. RESULTADOS DE npm test

Antes de estas correcciones: 496 total, 495 passed, 0 failed, 1 skipped.
Después: **556 total, 555 passed, 0 failed, 1 skipped**.
El skip es el test opcional de aislamiento del sistema operativo no disponible.
No se borraron tests para conseguir verde; se actualizaron reglas sustituidas.

## F. RESULTADOS DE npm run test:v2

**342 passed, 0 failed, 0 skipped**. Es subconjunto de npm test, no se suman cifras.
Los tests YCloud también se ejecutaron dentro de la suite completa.

## G. RESULTADOS DE npm run check

**OK: 24 archivos**, server.js y todos los módulos de lib.

## H. RESULTADO git diff --check

**OK**, sin errores de whitespace.

## I. TOTAL DE PRUEBAS NUEVAS

**60 pruebas nuevas** en scripts/test-v25-final.js. Todos los casos obligatorios
se cubren combinando esa suite con las de inventario, GUIA, ciclo, audio y V2.5
anteriores que se conservaron. Proveedores/modelos/Sheets están sustituidos por
mocks para probar transporte y recuperación sin llamadas reales. TEST_MODE tiene
pruebas específicas de cero generación y cero envíos, incluida confirmación TTS.

Cobertura nueva: cinco importes; ocho bordes de despacho; cuatro aceptaciones;
negación/corrección; TTS éxito/fallback/simulado/incierto; RESPONDER largo/corto/
crítico/inválido/incierto; ofertas aisladas y cambio de catálogo; ciudades únicas,
typo y homónimas; agencias; producto/cantidad/variante; cédula; stock posterior;
retiro previo a LLEGO; reinicio LLEGO/LIBERAR; 72 vs 96 horas; bodegas/nube/datos
ausentes/compra futura/repetición; video fallido y confirmación concurrente.

## J. RIESGOS/DEUDAS TÉCNICAS RESTANTES

- Locks y contadores presuponen una instancia; no coordinan múltiples réplicas.
  Meta conserva deduplicación parcial en RAM.
- Aceptación incierta de mensajes requiere reconciliación manual. No se promete
  exactly-once externo. Una presentación comercial puede quedar parcial si el
  proceso se interrumpe entre sus varios mensajes.
- Migración manual de fórmula de stock/estados y CH de pedidos históricos.
- T/U/W son fórmulas oficiales: una oferta manual se conserva en pedido/resumen
  y aviso, pero no modifica el precio calculado de Sheets. Conciliar ese importe
  antes de despachar; no se introdujo una columna contable sin autorización.
- Ofertas naturales ambiguas o multilínea no se interpretan como descuento
  automático. Se limita a total/cantidad inequívocos para un SKU y centavos exactos.
- ffmpeg/ffprobe no disponibles localmente: validar reproducción Opus y codecs
  de MP4. Recursos: 233 HTML/24 provincias/233 ciudades/679 agencias, sin tablas
  inválidas; 6 fotos y 3 videos. Originales del Desktop intactos.
- Ventana WhatsApp >24h: revisar plantillas para seguimientos; texto libre puede
  ser rechazado por proveedor. Seis avisos moderados heredados en dependencias,
  sin actualizaciones mayores automáticas.

## K. CONTRADICCIONES

La contradicción de monto/purga/LIBERAR quedó eliminada.
El prompt muestra un ejemplo GUIA sin paréntesis, pero declara formato oficial
con paréntesis y sintaxis exacta: se conservó ese formato oficial, sin nuevo alias.
La diferencia entre descuento por pedido y precio calculado en Sheets permanece
como decisión contable pendiente; no se sobrescribieron fórmulas para ocultarla.
No existen otros cambios de reglas conocidos pendientes de implementación local.

## L. PRUEBAS REALES ANTES DEL DEPLOY

En entorno controlado y con números internos autorizados:

1. Conversación con distintos SKU; fotos/video, fallo individual y ausencia de media.
2. Audio entrante, límite tres minutos, TTS cedar/Opus y fallback sin duplicados.
3. Bodegas, capacidad agotada, dato ausente y RESPONDER texto/audio desde el asesor.
4. Oferta manual 2 equipos, resumen, cambio 2→1→3 y aislamiento entre clientes;
   validar conciliación de importes con fórmulas reales antes de registrar.
5. Guayaquil/typo/ciudad ambigua, cards, ordinal, cambio de agencia y fallback texto.
6. Correcciones personales/producto/cantidad/variante, confirmación y reinicio;
   comprobar CH/LU únicos, aviso al asesor y silencio posterior.
7. Cierre logístico viernes 16:59/17:01, sábado 10:59/11:01 y domingo con reloj
   de entorno de prueba; verificar contenido y reproducción real.
8. GUIA por CH, stock cambiado/insuficiente, multilínea, duplicado/conflicto y
   última unidad; comprobar 3→2 por fórmula y columnas calculadas intactas.
9. LLEGO durante takeover, reinicio, LIBERAR repetido y aviso único.
10. Retiro semántico/manual, cancelación antes/después de guía y retiro tardío;
    verificar que cancelar no reincorpora stock.
11. Seguimientos en ventanas, tres días laborales y 48/96h comercial; comprobar
    aceptación de plantillas/transporte fuera de 24h.
12. Timeout/aceptación incierta y procedimiento de reconciliación administrativa.

Repositorio listo para revisión manual final. Sin deploy ni push automático.
