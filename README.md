# Level Up Store — bot comercial V3

Venta desde el primer contacto hasta la confirmación. Después de confirmar, escalar o detectar un reclamo, el chat queda pausado y no recibe respuestas automáticas. La logística queda a cargo de personas.

[Especificación vigente](SPEC.md) · [Informe de implementación y prueba real](docs/INFORME-V3.md) · [Inventario de recursos](docs/resources-manifest.json).

## Estado local

Implementación local, sin push, deploy ni cambios a producción. **Faltan recursos oficiales para habilitar el flujo real completo**: no existe `resources/Audios`, no hay multimedia MacBook y solo hay tres SKU con multimedia. No se inventan audios/transcripciones/malls; la ausencia de un recurso obligatorio pausa el chat con una razón persistida.

## Arquitectura activa

- `server.js`: Express, `/ycloud/webhook`, `/webhook`, `/health`, transporte y mantenimiento.
- `sales-flow`: etapas, selección, datos, resumen, confirmación semántica y pausa.
- `sales-catalog`: lectura estricta de `PAGINA DE STOCK!A2:G`; no expone escrituras de ventas.
- `sales-store`: `MEMORIA!A2:ZZ`, teléfonos canónicos, compatibilidad con A:C y fragmentación para JSON grande.
- `sales-interpreter`: OpenAI interpreta y extrae datos; código valida y elige textos aprobados.
- `sales-resources`: descubrimiento de multimedia/audios e imagen/PDF de agencias locales.
- `sales-technical`: respuestas acotadas a la ficha del SKU y políticas proporcionadas.
- Se reutilizan ingreso durable, firmas, parser de agencias, multimedia por SKU y transcripción YCloud.

`legacy/server-v25.js` y `legacy/SPEC-V25.md` conservan el runtime/contrato anteriores solo como referencia para suites históricas. El servidor activo no los importa ni ejecuta logística antigua. Las pruebas históricas usan su harness con raíz del proyecto; el archivo archivado no es otro servicio ni una entrada de arranque.

## Configuración

Conservar los secretos existentes fuera de Git. Ver `.env.example`. Variables del flujo:

| Variable | Uso |
| --- | --- |
| BUSINESS_NAME | Nombre comercial; default único en el motor: Level Up Store |
| YCLOUD_API_KEY / YCLOUD_PHONE_NUMBER / YCLOUD_WEBHOOK_SECRET | Proveedor, remitente y firma |
| GOOGLE_SERVICE_ACCOUNT_JSON | Autenticación existente de Sheets |
| STOCK_SPREADSHEET_ID / MEMORIA_SPREADSHEET_ID | Catálogo y memoria |
| OPENAI_API_KEY / MODEL_LOW / MODEL_TRANSCRIPTION | Interpretación y audio entrante |
| ASESOR_WHATSAPP | Único número autorizado para comandos |
| DELIVERY_MALLS_JSON | Array de nombres aprobados de malls; default `[]` |
| PRODUCT_VIDEO_FACTS_JSON | Objeto SKU → array de detalles visibles aprobados; default `{}` |
| RESOURCES_ROOT / AGENCIES_ROOT | Overrides opcionales de recursos locales |
| TEST_MODE | `true` bloquea red de transporte/modelos; usar suites con fixtures para simular ventas |

No se reconfiguró el número Meta. Sus rutas y firmas se conservan. El audio de venta en el runtime nuevo se transcribe mediante YCloud; audio Meta pausa para revisión, sin modificar su número.

## Recursos

Producto: `resources/productos/<SKU>/imagen/` y `video/`. Se usa una primera foto y un primer video en orden numérico, seguidos por ficha y Audio Comercial 1. El resto de fotos queda descubierto en el manifiesto. No se comparte video entre tamaños o SKU sin correspondencia aprobada.

Audios: `resources/Audios/`, nombres comerciales descriptivos, MP3/OGG. Una transcripción oficial debe guardarse junto al audio con el mismo nombre y extensión `.txt`; es necesaria para preferencias de texto o preguntas repetidas. Se comprueba ambigüedad de asignación. No se genera TTS ni se inventa el contenido de audios inexistentes.

Agencias: ruta real `resources/agencias/Ecuador/`, también configurable. 233 HTML, 24 provincias, 233 ciudades y 679 agencias. Hasta 15 agencias: PNG completos. Más de 15: PDF con todas las agencias, numeración global y páginas. No existen archivos de alias en este checkout; se reutiliza la normalización/búsqueda existente.

## Comandos

Solo desde `ASESOR_WHATSAPP`:

```text
/liberar +593999123456
/borrar +593999123456
```

Aceptan mayúsculas/espacios y número móvil ecuatoriano local, internacional o con prefijo `00`. `/liberar` conserva memoria y permite continuar. `/borrar` limpia campos, contexto, preferencias, audios y pendientes de ingreso, y activa el chat. La purga hace lo mismo al cumplir 30 días de inactividad; se ejecuta al arrancar y cada hora, además de la comprobación al leer el chat.

## Validación

```sh
npm run audit:resources
npm run check
npm test
npm run test:sales
npm run test:v2
npm run test:v25
npm run test:ycloud
git diff --check
```

Las suites usan fixtures y dependencias simuladas. Las pruebas HTTP necesitan permiso para escuchar en loopback; una restricción del sandbox puede producir `EPERM`. `npm test` ejecuta V3 más las pruebas históricas; las históricas no prueban el comportamiento del nuevo servidor. `test:legacy` conserva la selección original. No se eliminó una prueba logística para ocultar un fallo.

No ejecutar `test:integrations` con credenciales de producción para esta validación. Las pruebas reales requieren los recursos faltantes, un número YCloud de pruebas y Sheets separados. Los pasos se detallan en el informe.
