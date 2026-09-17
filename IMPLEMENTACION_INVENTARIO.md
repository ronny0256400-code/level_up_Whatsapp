# Integración de inventario y GUIA — 2026-09-16

Implementación local, sin despliegue ni llamadas a servicios reales. Continúa el Día 1 y conecta GUIA con la estructura final de inventario. No se añadieron integraciones de LLEGO ni calendario de retiro.

## Resultado

GUIA exige administrador autorizado, pedido existente sin derivación/cierre, guía válida y líneas con ID-PRODUCTO. Revalida existencias agregadas por ID y precios confirmados antes de escribir. Si falta stock en cualquier línea, conserva el estado del pedido, activa atención humana, alerta al administrador y no registra ventas ni envía mensajes al cliente. Después de actualizar existencias se puede repetir GUIA; DERIVAR permanece disponible si no existe venta ni escritura pendiente incierta.

Lee PAGINA DE STOCK A:G y el catálogo maestro DATOS L:R. Solo ofrece IDs visibles con existencias positivas, precio e información de Sheets. Mantiene separadas las variantes y cantidades.

Registra una fila por línea desde la fila 5 de REGISTRO DE VENTAS. Escribe únicamente B:O, S y V, con estado enviado y fechas de America/Guayaquil. Conserva P/Q/R/T/U/W. No escribe DATOS!P ni RE-STOCK: las fórmulas de Sheets calculan las existencias.

Todas las líneas se validan antes de construir un único spreadsheets.batchUpdate. Google documenta la aplicación atómica de sus subsolicitudes: [referencia oficial](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate). Las pruebas simulan también un subrequest inválido intermedio y comprueban cero filas parciales.

El pedido guarda guía, filas de venta, estado enviado y human_takeover. Un aviso persistente de envío puede atravesar exclusivamente el takeover creado por esa GUIA. TOMAR manual y no_contactar conservan su bloqueo; LIBERAR puede entregar un aviso pendiente. El bot queda en silencio después del aviso.

## Idempotencia y recuperación

Antes de escribir se consulta REGISTRO DE VENTAS por pedido y guía. Una repetición con las mismas líneas recupera la venta existente incluso si ya no queda stock. Una guía diferente o registro inconsistente congela y alerta. Se persiste la intención de GUIA antes de la escritura; DERIVAR no cierra pedidos con una venta o resultado de escritura incierto. El reintento reconcilia ventas y memoria tras pérdida de respuesta o reinicio entre ambas escrituras.

La cola por cliente serializa GUIA y DERIVAR; la cola global del adaptador serializa validación y registro entre pedidos. Los webhooks duplicados usan la deduplicación persistente existente.

Límites operativos: la exclusión es de una instancia Node. No ofrece un bloqueo distribuido entre réplicas ni frente a ediciones externas de Sheets. La prueba de última unidad simula el recálculo de Sheets antes de la siguiente lectura; no se verificaron latencias de recálculo en una hoja real. Las ventas y MEMORIA son escrituras separadas y se recuperan mediante reintento. El aviso marcado enviado no se repite tras reinicio; una caída después de aceptación por WhatsApp y antes de persistir ese éxito conserva el límite preexistente de posible duplicación del mensaje, al no existir transacción compartida entre transporte y memoria.

## Validación

- Antes de inventario: 272 pruebas, 271 aprobadas, 0 fallidas, 1 omitida.
- Capa de inventario aislada: 23/23 aprobadas.
- Inventario + GUIA: 44 pruebas (23 de adaptador y 21 de flujo).
- npm test completo final: 316 pruebas, 315 aprobadas, 0 fallidas, 1 omitida (prueba opcional del sandbox del sistema operativo).
- npm run check: aprobado.

Se cubren los 14 escenarios obligatorios: mono y multilínea, insuficiencia parcial, repetición, respuesta perdida, concurrencia del mismo pedido, pedido enviado, administrador no autorizado, stock exacto, fallo de batch intermedio, derivación previa, reinicio inmediato, fórmulas intactas y dos pedidos compitiendo por última unidad. También se prueban ambas ordenaciones de GUIA/DERIVAR, webhook duplicado, falta de ID, guía conflictiva, TOMAR y recuperación entre venta y memoria.

## Archivos de este bloque

- server.js: catálogo final, validaciones comerciales, GUIA, aviso persistente y coordinación con DERIVAR.
- lib/v2-inventory.js: adaptador de catálogo/ventas y exclusión global; helper de estados no conectado a LLEGO.
- lib/v2-policy.js: conservación de ID-PRODUCTO y cancelación de aviso pendiente.
- lib/v2-storage.js: simulador Sheets con rangos y batch atómico.
- scripts/helpers/inventory-fixture.js: catálogo y fórmulas sintéticas.
- scripts/helpers/v2-runtime.js: carga de inventario y reinicios simulados.
- scripts/test-v2-inventory.js y scripts/test-v2-guia.js: nuevas pruebas.
- scripts/test-v2-runtime.js, scripts/test-venta-real.js y scripts/test-ciclo-administrativo.js: fixtures con IDs y expectativas del takeover requerido.
- package.json: ambas suites incluidas en npm test/test:v2; sintaxis del adaptador en check.
- SPEC.md, README.md e IMPLEMENTACION_INVENTARIO.md: alcance y resultados.

Los otros cambios ya presentes en el árbol corresponden a trabajo anterior; no se eliminaron. No se cambiaron credenciales ni se modificaron hojas reales.
