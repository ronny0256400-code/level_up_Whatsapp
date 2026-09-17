# Orquestador — versión estable para uso diario

## Estado final

**AUTOMÁTICO**

- **Grok:** worker operativo mediante la API xAI.
- **Codex/integración:** integrador principal dentro del flujo de trabajo;
  revisa resultados y realiza los cambios autorizados. El script no inicia
  otra instancia de Codex ni aplica automáticamente respuestas de los workers.

**MANUAL/OPCIONAL**

- **Antigravity:** automatización temporalmente no disponible por autenticación.
  Su ausencia no bloquea Grok + Codex. El orquestador no lanza agy, no intenta
  autenticarse y no copia sesiones, cookies, tokens, llaveros ni credenciales.

## Uso diario: Grok + Codex

```sh
npm run ai:work -- .ai/tasks/TEST-GROK.md
```

Para una tarea propia, sustituir la ruta por su Markdown en `.ai/tasks/`.
El primer bloque JSON debe declarar `contextFiles`, una lista explícita de
rutas relativas al repositorio. Se envían solo la tarea, AGENTS.md,
CURRENT_STATE.md si existe y los archivos autorizados. No se entrega el repo
completo. Las respuestas se guardan en `.ai/reports/` para revisión de Codex.

Requiere Node >=20.6 por el soporte nativo `--env-file=.env`. Node carga el
entorno; el código no abre ni muestra `.env`. Grok usa exclusivamente
`process.env.XAI_API_KEY`. Modelo predeterminado: grok-4.6. Se conservan
GROK_MODEL y GROK_TIMEOUT_MS (120000 ms por defecto, máximo 600000).
No hay reintentos automáticos ni ejecución paralela de workers.

## Antigravity: preparar ejecución manual opcional

```sh
npm run ai:work -- --worker antigravity .ai/tasks/TEST-ANTIGRAVITY.md
```

La tarea debe tener `"mode": "analysis-only"`. El comando prepara un archivo
`antigravity-<id>-manual-task.md` en `.ai/reports/`, con la tarea y el contexto
explícito, incluyendo ARCHITECTURE.md si existe. La ruta absoluta se imprime
como `Tarea: ...` y queda registrada en el reporte de preparación.

Devuelve `ANTIGRAVITY: MANUAL_REQUIRED` y código de salida **0**: se preparó el
paquete correctamente, pero no significa que Antigravity haya respondido.
El reporte declara `automaticAvailability: unavailable`, `taskSent: false`
y `nonBlocking: true`. Una tarea inválida o un fallo al guardar sí devuelve
FAILED y código 1; los errores reales no se ocultan como éxitos.

El usuario puede entregar manualmente solo el paquete a Antigravity, sin abrir
el repositorio real ni copiar credenciales. Este paquete es texto, no una
sesión autenticada ni un mecanismo de ejecución. Su preparación no abre la
aplicación ni inicia el worker.

No es necesario esperar la respuesta. Para continuar la misma tarea con Grok:

```sh
npm run ai:work -- .ai/tasks/TEST-ANTIGRAVITY.md
```

## Importar un reporte manual

Guardar el resultado textual de Antigravity en un archivo Markdown dentro del
repositorio, por ejemplo `.ai/manual-result.md`, y ejecutar:

```sh
npm run ai:work -- --worker antigravity .ai/tasks/TEST-ANTIGRAVITY.md --import-report .ai/manual-result.md
```

Se crea un reporte nuevo en `.ai/reports/`, con `origin: manual-import`, ruta
de origen y `reviewRequired: true`. COMPLETE significa importación completada,
no ejecución automática ni autenticación verificada. Codex revisa el contenido
antes de integrar cualquier recomendación. No se ejecutan comandos del texto,
no se sobrescribe el origen y no se aplican cambios de código.

Se rechazan reportes vacíos, rutas que salen del repo, enlaces simbólicos,
archivos de entorno, nombres de credenciales y contenido sensible reconocible.
Los archivos tienen un límite de 128 KiB; el contexto completo, 256 KiB.
Estos filtros no identifican todos los secretos posibles: revisar el texto
antes de entregarlo o importarlo sigue siendo necesario.

## Sandbox conservado

`scripts/ai-sandbox.js` y `scripts/ai-worker-antigravity.js` conservan la
implementación aislada de V2.1 y sus pruebas. La ejecución automática no está
conectada al flujo de uso diario; ninguna opción de ai:work la reactiva.
No se vuelve a intentar resolver autenticación en esta versión.

El sandbox macOS crea copias temporales fuera del repo, rechaza traversal,
.env, .git, node_modules y archivos no autorizados, y usa sandbox-exec para
bloquear el repositorio original. Sus cambios nunca se sincronizan de vuelta.
La eliminación al terminar y la conservación opcional para debug están
implementadas. Este backend es específico de macOS y no se ejecutó nuevamente
al cerrar la versión. La última prueba real aislada quedó bloqueada por
`authenticationRequired`, con el sandbox eliminado.

## Verificación de cierre

```sh
node --test scripts/test-ai-orchestrator.js scripts/test-ai-manual.js
```

**13 tests aprobados**, sin fallos ni omisiones. Cubren el paquete mínimo, ruta
visible, estado no bloqueante, importación y revisión pendiente, rechazo de
entradas inseguras y continuación con Grok, además de las regresiones del
worker Grok. Solo usan archivos temporales y respuestas simuladas: no llaman
a APIs ni intentan iniciar sesión.

La versión queda **estable para uso diario con Grok + Codex y Antigravity
manual/opcional**. La conexión real de Grok fue validada en la etapa anterior.
Producción y credenciales no forman parte de estos cambios. Sin commit ni push.
