# Auditoría real V5 Seller — 2026-10-02

Auditoría hecha sobre el ZIP local actual, rama `v5-seller`, no sobre el snapshot antiguo de GitHub.

## Bugs confirmados en código

1. **V5 ignoraba todos los audios antes de llegar al vendedor.**
   `lib/v4-runtime.js` aceptaba únicamente `message.type === "text"`. Como `USE_V5=true` reutiliza ese runtime, cualquier `audio`/`voice` era descartado con `ignored` y nunca llegaba a `ycloud-audio.js`.

2. **Aunque se conectara la ruta de audio, la configuración local no tenía `MODEL_TRANSCRIPTION`.**
   `ycloud-audio.js`/`v2-models.js` rechazaban la transcripción cuando esa variable faltaba. El runtime V5 corregido usa `gpt-4o-mini-transcribe` como valor por defecto solo para la ruta V5 si no existe configuración explícita.

3. **Una referencia MacBook podía borrar el contexto de opciones recientes.**
   En `lib/v5-seller.js`, cualquier texto con “MacBook” sin palabras consideradas `criteria` se convertía nuevamente en `MACBOOK_ENTRY`. Por eso frases como `La MacBook Pro de 160` podían vaciar `lastOptions` y volver a preguntar características.

4. **Las referencias a productos ya mostrados se intentaban interpretar con IA antes de resolver el contexto local.**
   Esto hacía innecesariamente frágiles expresiones como `la última`, `la de 160` o una etiqueta completa copiada del propio bot. La versión corregida resuelve primero `lastOptions`; solo llama al intérprete si no existe una referencia determinística.

5. **El matcher no reconocía bien una capacidad desnuda dentro de una etiqueta MacBook.**
   `MACBOOK PRO ... 160 ...` sin `160 GB` podía no filtrar por almacenamiento. Se añadió coincidencia de capacidades conocidas cuando el mensaje hace referencia explícita a MacBook.

6. **“Fotos y características” tomaba la ruta equivocada.**
   El chequeo de `características` ocurría antes del chequeo multimedia, por lo que `Envíeme fotos y características` podía enviar solo texto en lugar de iniciar presentación. Ahora foto/video tiene prioridad cuando hay producto activo.

7. **“Laptop” dentro de una conversación MacBook podía cambiar la familia a Windows.**
   La detección consideraba cualquier aparición de `laptop` como `windows`. Ahora `laptop` solo abre Windows cuando aún no hay familia o ya se está en Windows; marcas/`windows` explícitos sí cambian la familia.

8. **La presentación duplicaba la solicitud de ubicación.**
   Después de Comercial 1 se enviaba además texto preguntando ciudad/provincia aunque el audio ya lo solicita. Ahora ese texto se usa solo si Comercial 1 no está disponible.

9. **Las entradas Windows/iPad eran más pobres que el guion comercial aprobado.**
   Se restauró precio “desde”, promoción/envío gratis y listado dinámico. iPad deduplica modelo+capacidad para no repetir variantes por color.

## Hallazgo estructural importante (no es un bug puntual)

El archivo `docs/V5-SELLER.md` confirma que la V5 subida fue construida como MVP incompleto:

- solo soportaba mensajes de texto;
- agencias se consultaban, pero V5 no registraba ventas;
- no completaba confirmación/pedido/logística;
- no reservaba/descontaba stock;
- el contexto V5 era solo memoria y se perdía al reiniciar.

Por eso, aunque los tests V5 anteriores estuvieran verdes, no podían demostrar el flujo final que se esperaba en WhatsApp. Los mocks validaban rutas parciales, no el recorrido real completo.

## Cambios aplicados en esta revisión

- Audio YCloud → transcripción → mismo `flow.process()` que texto.
- Respuesta segura si una transcripción falla; nunca silencio.
- Default V5 de transcripción si `MODEL_TRANSCRIPTION` no está configurado.
- Resolución determinística de referencias antes de IA.
- Protección de `lastOptions` para referencias MacBook.
- Matching de capacidad MacBook más tolerante.
- Multimedia con prioridad sobre respuesta de características.
- Protección contra cambio accidental MacBook→Windows por la palabra “laptop”.
- Guion inicial Windows/iPad mejor alineado al aprobado.
- Eliminación de pregunta de ubicación duplicada tras Comercial 1.

## Pruebas añadidas

- referencia MacBook numérica conserva contexto;
- etiqueta reciente exacta se resuelve sin IA;
- “fotos y características” entra a presentación;
- audio V5 transcribe y usa el mismo flujo de venta;
- fallo de audio responde al cliente en vez de quedar en silencio.

`npm run test:v5`: 24/24 aprobadas.
`npm run check`: sintaxis OK (39 archivos).
`git diff --check` sobre archivos modificados: OK.

La suite completa en este contenedor dio 6 fallos ajenos a estos cambios porque el ZIP incluía `node_modules` de macOS y el contenedor Linux no contiene el binario nativo `@resvg/resvg-js-linux-x64-gnu`. Los fallos están concentrados en render PNG de agencias. No son fallos lógicos detectados en V5. En el Mac original debe ejecutarse la suite con sus dependencias nativas locales.

## Archivos corregidos

- `lib/v4-runtime.js`
- `lib/v4-decision.js`
- `lib/v5-seller.js`
- `scripts/test-v5.js`

## Siguiente requisito antes de llamar a V5 “final”

Completar y probar en la propia ruta V5 el tramo `LOCATION → AGENCY → DATA → CONFIRMATION → CONFIRMED` y enlazarlo con el flujo administrativo de GUIA. La V5 recibida no contiene todavía ese recorrido completo, aunque el código legado sí dispone de piezas para agencias, confirmación y comandos administrativos.
