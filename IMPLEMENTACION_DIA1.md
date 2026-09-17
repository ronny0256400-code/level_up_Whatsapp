# Día 1 — implementación #1

Fecha: 2026-09-16. Reglas: [SPEC.md](SPEC.md). Esta entrega no inicia Día 2 ni modifica inventario real.

## Resultado

Se incorporaron primero las 18 resoluciones oficiales a SPEC. Se añadió una capa V2 alrededor del flujo comercial existente, conservando las funciones V1 que siguen siendo aplicables y su persistencia de pedidos/retiro.

| Objetivo | Implementación |
| --- | --- |
| A. Estados | Enumeración oficial, transiciones de flujo y control, versión de esquema, compatibilidad con terminales antiguos, estado previo humano y oportunidades independientes. El pedido anterior se conserva en `oportunidades`; GUIA/LLEGO pueden localizarlo allí y su scheduler sigue procesándolo. |
| B–F. Router y control | Router determinístico antes de OpenAI; postventa supera compra mixta, activa `postventa_humano` + `human_takeover`, conserva pedido y avisa al administrador sin responder al cliente. TOMAR/LIBERAR persistidos. Cierres, NO_CONTACTAR, no_interesado y spam silencian; solo una intención positiva explícita abre otra oportunidad. Negaciones y mensajes mínimos no disparan modelos. |
| G–H. Entrada | IDs deduplicados antes del buffer de 5 segundos y antes de contabilizar rate limit. Inbox, IDs y ventana de frecuencia persistidos en `ENTRADAS_V2`; recuperación tras reinicio. Un grupo de textos rápidos se procesa en una sola ejecución. Administración no espera la ventana comercial. |
| I–K. Acceso/eco/límite | Administrador validado estrictamente desde `ASESOR_WHATSAPP`, POST Meta autenticado con firma de cuerpo original, firmas YCloud conservadas. Se procesan todos los mensajes de los lotes Meta. Ecos y mensajes propios filtrados; 20 mensajes/minuto por número. |
| L. Pedidos | Estructura multilínea con producto, capacidad, color, cantidad, precio_unitario, subtotal y total calculado en centavos. Resumen y confirmación soportan líneas; teléfono procede de WhatsApp. Total mayor a $300 congela y alerta incluso antes de completar datos personales; $300 exactos continúan. IDs LU persistentes con comprobación en Sheets y reserva de contador. Sin descuento de stock. |
| M–N. Privacidad/métricas | Eliminado el log del payload. Logs de reglas/transiciones, errores y modelos sin cuerpos, cédulas, tokens, credenciales ni URLs de medios. Métricas de Responses y transcripción: llamadas, modelo, tokens disponibles y costo opcional; persisten junto a la oportunidad. No se registra el texto de la transcripción en logs. |
| O. Modelos | `MODEL_LOW`, `MODEL_NORMAL`, `MODEL_HIGH`; clasificación/extracción en LOW, respuesta comercial en NORMAL. HIGH preparado pero no activado arbitrariamente. `MODEL_TRANSCRIPTION` para audio. Sin nombres de modelos de producción fijados en código. |
| P. Transportes | YCloud ya no envía su respuesta de conectividad. Ambos proveedores entran al router y toda salida cliente consulta la guarda de estado. El adaptador YCloud sin guarda rechaza enviar. TEST_MODE bloquea envíos reales de ambos proveedores y usa Sheets/OpenAI simulados. |

También se implementó DERIVAR para pedidos confirmados: cierre con `closure_reason=derivado_competencia` y cancelación de jobs/next actions/seguimientos asociados. PAGO y RETIRADO quedaron sin efecto administrativo.

LLEGO durante takeover conserva llegada y programación, pero deja el aviso pendiente sin consumir intentos de envío. LIBERAR restaura logística y entrega el aviso pendiente; repetir LIBERAR no vuelve a entregarlo. Las alertas humanas fallidas tienen hasta tres intentos persistidos, separados por al menos un minuto; su contenido pendiente se elimina al registrar envío exitoso.

Audio superior a 180 segundos no se transcribe y recibe respuesta fija si el chat permite responder. Para Meta se verifica duración real después de descargar y antes de transcribir: Ogg/Opus se analiza localmente; otros formatos requieren `ffprobe`. Descarga limitada a 16 MiB y archivo temporal privado. Duración desconocida/fallida no se envía al modelo. Un audio en un chat silenciado no se descarga ni transcribe.

## Archivos modificados y nuevos

- `SPEC.md`: resoluciones oficiales y alcance autorizado.
- `server.js`: integración del router, control humano, guardas, firmas, inbox, métricas, pedidos y compatibilidad del scheduler con oportunidades anteriores.
- `lib/v2-policy.js`: estados, decisiones, transiciones, cancelación y cálculo multilínea.
- `lib/v2-ingress.js`: firma Meta, ecos, deduplicación, agrupación, rate limit y recuperación.
- `lib/v2-storage.js`: inbox Sheets y almacenamiento aislado para TEST_MODE.
- `lib/v2-models.js`: selección configurable y métricas sin contenido sensible.
- `lib/v2-audio.js`: comprobación de duración previa a transcripción.
- `lib/ycloud-webhook.js`, `lib/ycloud-client.js`: recepción al router común y salida con guarda obligatoria.
- `scripts/test-v2-policy.js`, `scripts/test-v2-runtime.js`, `scripts/helpers/v2-runtime.js`: pruebas nuevas con reloj, transporte y Sheets simulados.
- `scripts/test-v1.js`, `scripts/test-venta-real.js`, `scripts/test-ciclo-administrativo.js`, `scripts/test-ycloud-webhook.js`: adaptadores de prueba actualizados y expectativas incompatibles V1 sustituidas por las resoluciones V2.
- `package.json`: `npm test`, `test:v2` y validación sintáctica de módulos.
- `.env.example`, `README.md`, `docs/YCLOUD.md`: configuración sin credenciales y documentación técnica actualizada.
- `IMPLEMENTACION_DIA1.md`: este informe.

No se cambiaron `.env`, credenciales, herramientas de desarrollo IA, archivos no versionados previos ni configuración de Render. La auditoría inicial se conserva como documento histórico.

## Pruebas antes/después

| Momento | Resultado |
| --- | --- |
| Auditoría inicial | 202 pruebas: 200 aprobadas, 1 fallida por PII en DEBUG MENSAJE, 1 omitida. YCloud no pudo abrir localhost. |
| Primer grupo V2 | 22 pruebas de políticas/inbox/modelos aprobadas. |
| Integración y regresiones | Se ejecutaron grupos después de conectar router, controles, pedidos y scheduler. Los fallos de expectativas V1 se investigaron y adaptaron a las resoluciones oficiales. |
| Verificación final | **272 pruebas: 271 aprobadas, 0 fallidas, 1 omitida**, mediante `npm test`. Incluye HTTP YCloud/Meta, políticas V2, runtime y herramientas IA con dependencias simuladas. |
| Sintaxis/diff | `npm run check` y `git diff --check`: correctos. |

La prueba omitida es el ensayo opt-in del aislamiento OS de la herramienta de desarrollo (`AI_TEST_OS=1`); no es una prueba funcional del chatbot. La suite HTTP pudo ejecutarse tras autorizar el puerto local fuera de la restricción inicial. No quedan fallos ocultos de la suite ejecutada.

Cambios intencionales en expectativas V1:

- PAGO/RETIRADO ya no deben producir pago ni cambiar campos.
- Un saludo en terminal sigue dando cero modelos; una nueva compra explícita ya no debe quedar bloqueada para siempre. Su reactivación se comprueba separadamente.
- Rechazo explícito de compra se resuelve sin clasificador, como `no_interesado`.
- La estructura permite estado V2 y actividad persistida sin alterar el pedido anterior.
- Se conservan las pruebas V1 de calendario como regresión del scheduler heredado: **no prueban cumplimiento del calendario V2 pendiente de Día 2**.

La suite automática no carga `.env`, no inicia el servidor de producción, no llama APIs reales ni altera stock real. `test:integrations` sigue siendo un diagnóstico externo separado y no fue ejecutado.

## Configuración y límites actuales

Antes de desplegar, establecer las variables nuevas de `.env.example` en el entorno de Render. `WHATSAPP_APP_SECRET` ausente rechaza POST Meta con 503; firma inválida produce 401. Los niveles de modelo deben tener nombres válidos configurados. El número propio sirve para filtrar ecos. No se configuró ni desplegó Render en esta entrega.

El costo estimado requiere tarifas explícitas por millón de tokens para cada nivel y, opcionalmente, por minuto de transcripción. Sin tarifas o uso disponible se conserva `null` (desconocido), nunca un cero inventado. Las tarifas no se consultan ni se fijan por iniciativa propia.

La implementación soporta una instancia Node. Sheets persiste el trabajo, pero los bloqueos siguen siendo locales al proceso. Dos réplicas pueden competir por inventario, contador o inbox; no se declara garantía distribuida. Los IDs pueden tener saltos si una confirmación falla tras reservar un número.

Los mensajes pendientes se guardan hasta procesarlos; la deduplicación conserva IDs recientes y fragmenta valores grandes para respetar el límite por celda de Sheets. Las escrituras de Sheets y los envíos de WhatsApp no forman una transacción conjunta: un fallo justo después del envío y antes de persistir su éxito puede duplicar una notificación al recuperarse. Las pruebas de ejecución única cubren duplicados normales y reinicio con recepción persistida, no una garantía universal de entrega exactamente una vez.

El buffer normal usa un temporizador de cinco segundos; el inbox se reconstruye también cada cinco segundos. Un servicio detenido no puede procesar a tiempo. Sheets implica latencia y cuotas que deberán medirse con tráfico real.

Audio YCloud todavía utiliza respuesta fija para pedir texto, sin descargar URLs de medios. La transcripción existente Meta continúa con verificación de duración; formatos distintos de Ogg/Opus requieren `ffprobe` en el entorno. Reactivación de chats silenciados se reconoce en texto; el silencio se aplica antes de descargar/transcribir audio.

**Pendiente para bloques posteriores, sin iniciar Día 2:** validación/descuento atómico de stock y registro de ventas en GUIA, calendario V2 de cuatro horas/tres días laborales, seguimientos comerciales 48/96, limpieza por retención y multimedia general. GUIA conserva su operación de metadatos V1 y añade guardas de cierre/límite; no descuenta inventario ni se presenta como la implementación completa de GUIA V2. El calendario heredado sigue en dos horas/09:00/72 horas hasta su bloque de migración.

No hay un bloqueo de implementación pendiente para entregar este bloque. El despliegue real y la configuración remota no fueron parte de esta ejecución.
