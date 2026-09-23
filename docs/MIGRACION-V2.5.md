# Migración operativa V2.5 — pendiente de aplicación manual

No desplegar hasta validar este procedimiento. El backend no ejecuta esta
migración ni escribe DATOS!P o RE-STOCK.

## Fórmula de stock

La fórmula anterior usa `pagado`; las nuevas ventas terminan en `retirado`.
El propietario debe actualizar la fórmula real según los rangos de su archivo,
conservando el cálculo por ID-PRODUCTO y verificando las cantidades. Concepto
operativo solicitado:

```
RE-STOCK
- cantidades enviado
- cantidades en agencia
- cantidades retirado
- cantidades cancelado
+ cantidades devuelto físico/manual
```

`cancelado` mantiene el equipo fuera del inventario; solo el retorno físico
marcado manualmente como `devuelto` lo reincorpora. No inferir retornos por
vencimiento ni crear un comando de devolución.

Este concepto no es una fórmula A1 lista para pegar: revisar el tratamiento
histórico de devoluciones/reingresos para no contar dos veces una entrada.
Verificar con un SKU y cantidad uno el ciclo 3 → 2 al registrar GUIA; pasar de
enviado a en agencia/retirado/cancelado debe conservar 2. Reconciliar devoluciones
contra existencias físicas y el registro histórico antes de cerrar la migración.

La tabla manual B:G de DATOS y el maestro L:R son independientes.
PAGINA DE STOCK conserva A3:G evaluado y fila 2 de encabezados. No incluir H:I.
Ventas mantiene fila 4 de encabezados y datos B5:W. Mantener fórmulas P/Q/R/T/U/W.
GUIA escribe B:O, S, V; LLEGO/cancelación escriben F; retiro escribe F/H.

`lib/v2-sheet-migration.js` contiene un diagnóstico de solo lectura:
`diagnoseSheets(sheets, spreadsheetId)` lee DATOS!P3:P como FORMULA y devuelve
conteo, estados ausentes y presencia de pagado. No imprime fórmulas ni datos.
Es heurístico: no sustituye verificar aritmética con casos concretos. No se
invoca automáticamente en runtime ni durante tests contra Sheets reales.

## Persistencia y compatibilidad

- Los JSON de MEMORIA siguen siendo la fuente de verdad.
- LU no cambia; CH se reserva en un contador separado al confirmar pedidos nuevos.
- No asignar CH automáticamente a borradores ni migrar masivamente pedidos viejos.
- Históricos sin CH no pueden recibir GUIA usando el nuevo comando: revisar y
  vincularlos manualmente antes del corte operativo, sin regenerar ni perder LU.
- pagado se lee retirado; sin_respuesta/no_retirado se leen cancelado terminal
  histórico. Conservar fechas e IDs, sin seguimientos retroactivos.
- Nuevos retiros usan fechaRetiro. Nunca limpiar historial normal en bloque.
- Outbox `incierta`: revisar aceptación en el proveedor antes de cualquier acción
  manual. No cambiarlo a pendiente sin reconciliar entrega.
- Ejecutar una sola instancia del backend: los locks no coordinan réplicas.

## Recursos y dependencias

Se importaron 233 HTML, 24 provincias, 233 ciudades y 679 agencias válidas;
0 tablas inválidas. Los registros siguen siendo los filtrados por el propietario.
Se importaron 6 fotos y 3 videos para tres SKU. Las dos fotos de IPADAIR1-32-PLA
estaban en la raíz de ese SKU y se movieron a imagen/ solo en la copia del repo.
Se excluyeron archivos .DS_Store. Los originales del Desktop no se modificaron.

@resvg/resvg-js renderiza PNG sin navegador. Noto Sans se distribuye con su
licencia OFL. No busca fuentes del sistema, evitando bloqueos y diferencias de
Render. Los HTML nunca ejecutan scripts ni descargan imágenes externas.

En el entorno de desarrollo no hay ffmpeg/ffprobe. El camino de Opus directo es
obligatorio y está mockeado; verificar codecs H.264/AAC de MP4 y reproducción de
Opus con el proveedor antes de producción. Todos los archivos importados están
dentro de los límites de tamaño para su tipo.

## Revisión previa a producción

1. Respaldar Sheets/MEMORIA; revisar fórmula y estados históricos manualmente.
2. Todos los montos siguen el mismo flujo, sin purga ni excepción de liberación.
   Reconciliar descuentos manuales del pedido con T/U/W calculadas: el backend
   no sobrescribe fórmulas ni introduce una columna nueva de descuentos.
3. Revisar avisos inciertos y pedidos históricos sin ID_CHAT.
4. Probar con números internos autorizados el recorrido completo, nunca clientes
   durante la validación local: conversación, fotos/video/TTS, agencia, datos,
   confirmación, GUIA, LLEGO/LIBERAR, retiro normal/tardío y cancelación.
5. Verificar ventanas/plantillas WhatsApp para recordatorios posteriores a 24 h;
   el transporte existente utiliza texto libre y puede ser rechazado por el proveedor.
6. Revisar audit de dependencias: dependencias heredadas tienen avisos moderados;
   actualizar majors requiere su propia revisión, no un `audit fix --force` ciego.

No se hizo deploy, push, envío real ni escritura real de Sheets en esta tarea.
