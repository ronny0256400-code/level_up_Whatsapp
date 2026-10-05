# V5 Seller local

Activación (detener primero el proceso local anterior):

```sh
USE_V5=true node --env-file=.env server.js
```

No se ha arrancado el bot ni enviado mensajes reales durante la implementación.
USE_V5 tiene prioridad sobre USE_V4. Sin ambas banderas se conserva V3.
El handler YCloud existente responde HTTP 200 y procesa en segundo plano.
La infraestructura YCloud y los webhooks remotos no cambian.

Motor nuevo: mensaje + contexto + catálogo oficial → clasificación IA reutilizada
(reintento 800/1500 tokens, razonamiento mínimo) → referencias/reglas validadas →
respuesta/presentación → nextBestAction → contexto en memoria.
La información de Sheets es de solo lectura; reiniciar pierde contexto V5.
El último mensaje del bot, acción, tipo, opciones, filtros y producto se pasan al intérprete.
Las preguntas auxiliares conservan step. Seleccionar presenta y avanza a LOCATION.
La presentación usa fotos, primer video, ficha sin reescritura, precio oficial y Comercial 1.
Recursos faltantes se registran; no congelan una consulta normal.

Respuestas específicas: la IA selecciona hasta dos extractos breves de fichas o
TXT oficiales. El código valida pertenencia literal antes de enviarlos y añade
el siguiente paso comercial. Si no hay evidencia suficiente, se solicita asesor.
El aviso humano se ofrece mediante el callback escalate; el transporte reutilizado
no envía alertas reales a un administrador por defecto.

Agencias se consultan con el índice HTML existente para ciudad/provincia; esta
fase no registra ventas, confirma pedidos, reserva stock ni completa logística.
V5 continúa usando los comandos locales borrar/liberar, deduplicación y exclusión
por teléfono del runtime existente. Solo mensajes de texto están soportados.
Leído → typing → 5000 ms una vez por respuesta/bloque; fallos typing no bloquean.

Pruebas: npm run test:v5, npm test, npm run check, git diff --check.
Las pruebas usan datos ficticios y mocks; no prueban disponibilidad remota real.
