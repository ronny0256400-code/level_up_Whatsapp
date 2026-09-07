const express = require("express");
const OpenAI = require("openai");
const { google } = require("googleapis");

const app = express();

// ==========================================
// MEMORIA DE CONVERSACIONES
// ==========================================


const conversaciones = new Map();


app.use(express.json());

// =====================================================
// CONFIGURACIÓN OPENAi
// =====================================================

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
// ============================================================
// TRANSCRIBIR AUDIO DE WHATSAPP
// ============================================================

async function transcribirAudio(mediaId) {
    let audioPath = null;

    try {
        console.log("🎤 Obteniendo audio de WhatsApp:", mediaId);

        // 1. Obtener información del audio desde Meta
        const mediaResponse = await fetch(
            `https://graph.facebook.com/v23.0/${mediaId}`,
            {
                headers: {
                    Authorization: `Bearer ${WHATSAPP_TOKEN}`,
                },
            }
        );

        if (!mediaResponse.ok) {
            const errorTexto = await mediaResponse.text();

            throw new Error(
                `Error obteniendo información del audio: ${mediaResponse.status} ${errorTexto}`
            );
        }

        const mediaData = await mediaResponse.json();

        console.log("🔗 URL temporal del audio obtenida");

        // 2. Descargar el audio
        const audioResponse = await fetch(mediaData.url, {
            headers: {
                Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            },
        });

        if (!audioResponse.ok) {
            const errorTexto = await audioResponse.text();

            throw new Error(
                `Error descargando audio: ${audioResponse.status} ${errorTexto}`
            );
        }

        const audioBuffer = Buffer.from(
            await audioResponse.arrayBuffer()
        );

        console.log(
            "📥 Audio descargado:",
            audioBuffer.length,
            "bytes"
        );

        // 3. Crear archivo temporal
        const fs = require("fs");
        const path = require("path");
        const os = require("os");

        let extension = ".ogg";

        if (mediaData.mime_type) {
            if (mediaData.mime_type.includes("mp4")) {
                extension = ".mp4";
            } else if (mediaData.mime_type.includes("mpeg")) {
                extension = ".mp3";
            } else if (mediaData.mime_type.includes("wav")) {
                extension = ".wav";
            } else if (mediaData.mime_type.includes("webm")) {
                extension = ".webm";
            }
        }

        audioPath = path.join(
            os.tmpdir(),
            `whatsapp-${mediaId}${extension}`
        );

        fs.writeFileSync(audioPath, audioBuffer);

        console.log("💾 Audio temporal guardado:", audioPath);

        // 4. Transcribir con OpenAI
        console.log("🤖 Enviando audio a OpenAI...");

        const transcripcion =
            await openai.audio.transcriptions.create({
                file: fs.createReadStream(audioPath),
                model: "gpt-4o-mini-transcribe",
                language: "es",
            });

        console.log(
            "📝 Transcripción:",
            transcripcion.text
        );

        return transcripcion.text;

    } catch (error) {

        console.error(
            "❌ Error transcribiendo audio:",
            error
        );

        return null;

    } finally {

        // 5. Eliminar archivo temporal
        if (audioPath) {
            try {
                const fs = require("fs");

                if (fs.existsSync(audioPath)) {
                    fs.unlinkSync(audioPath);
                    console.log("🗑️ Archivo temporal eliminado");
                }

            } catch (error) {
                console.error(
                    "⚠️ No se pudo eliminar el archivo temporal:",
                    error
                );
            }
        }
    }
}

// =====================================================
// CONFIGURACIÓN WHATSAPP
// =====================================================

const VERIFY_TOKEN = "levelup_verification_2026";

const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const ASESOR_WHATSAPP = process.env.ASESOR_WHATSAPP;

// =====================================================
// CONFIGURACIÓN GOOGLE SHEETS
// =====================================================

const STOCK_SPREADSHEET_ID =
  "1geYhn1AtyV0n75MtaX1Zo1ka4qEEKtTrbiTkViLswR0";

const MEMORIA_SPREADSHEET_ID =
  "1uQ-YrSQR10-6mBkFWckx2KhHQJTIn4FfjAZ0XIaQg0g";

const googleCredentials = JSON.parse(
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON
);

const auth = new google.auth.GoogleAuth({
  credentials: googleCredentials,
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
  ],
});

const sheets = google.sheets({
  version: "v4",
  auth,
});

// =====================================================
// LEER STOCK DESDE GOOGLE SHEETS
// =====================================================

async function obtenerStock() {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: STOCK_SPREADSHEET_ID,
    range: "'PAGINA DE STOCK'!A2:G100",
  });

  const rows = response.data.values || [];

  const productosDisponibles = rows
    .map((fila) => {
      const codigo = String(fila[0] || "").trim();
      const producto = String(fila[1] || "").trim();
      const capacidad = String(fila[2] || "").trim();
      const stock = Number(fila[3]) || 0;
      const precio = String(fila[4] || "").trim();
      const activo = String(fila[5] || "").trim().toUpperCase();
      const informacion = String(fila[6] || "").trim();

      return {
        codigo,
        producto,
        capacidad,
        stock,
        precio,
        activo,
        informacion,
        disponible: stock > 0 && activo === "SI"
      };
    })
    .filter(producto => producto.disponible);

  return productosDisponibles;
}

async function obtenerConversacion(numero) {
  const numeroNormalizado = String(numero);

  // Primero revisamos la memoria que ya está en RAM
  if (conversaciones.has(numeroNormalizado)) {
    return conversaciones.get(numeroNormalizado);
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: MEMORIA_SPREADSHEET_ID,
    range: "MEMORIA!A2:C1000",
  });

  const rows = response.data.values || [];

  const fila = rows.find(
    row => String(row[0] || "") === numeroNormalizado
  );

  let conversacion;

  if (fila && fila[1]) {
    try {
      conversacion = JSON.parse(fila[1]);
    } catch (error) {
      console.log("Historial inválido, creando conversación nueva.");
    }
  }

  if (!conversacion) {
    conversacion = {
      producto: null,
      etapa: "inicio",
      datosCliente: {},
      confirmado: false,
      historial: []
    };
  }

  conversaciones.set(numeroNormalizado, conversacion);

  return conversacion;
}

// ============================================================
// GUARDAR CONVERSACIÓN EN MEMORIA
// ============================================================

async function guardarConversacion(numero, conversacion) {
    try {
        const numeroNormalizado = String(numero);

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: MEMORIA_SPREADSHEET_ID,
            range: "MEMORIA!A2:C1000",
        });

        const rows = response.data.values || [];

        const indiceFila = rows.findIndex(
            row => String(row[0] || "") === numeroNormalizado
        );

        // Si el número ya existe, actualizamos esa fila.
        // Si no existe, creamos una nueva.
        const fila = indiceFila >= 0
            ? indiceFila + 2
            : rows.length + 2;

        await sheets.spreadsheets.values.update({
            spreadsheetId: MEMORIA_SPREADSHEET_ID,
            range: `MEMORIA!A${fila}:C${fila}`,
            valueInputOption: "RAW",
            requestBody: {
                values: [[
                    numeroNormalizado,
                    JSON.stringify(conversacion),
                    new Date().toISOString()
                ]]
            }
        });

        console.log("💾 Conversación guardada en MEMORIA:", numeroNormalizado);

    } catch (error) {
        console.error("❌ Error guardando conversación en MEMORIA:", error);
    }
}

async function actualizarGuiaPedido(idPedido, numeroGuia) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: MEMORIA_SPREADSHEET_ID,
            range: "MEMORIA!A2:C1000",
        });

        const rows = response.data.values || [];

        for (let i = 0; i < rows.length; i++) {
            const numeroCliente = String(rows[i][0] || "");
            const historialGuardado = rows[i][1];

            if (!historialGuardado) continue;

            let conversacion;

            try {
                conversacion = JSON.parse(historialGuardado);
            } catch (error) {
                continue;
            }

            if (
                !conversacion.pedido ||
                conversacion.pedido.id !== idPedido
            ) {
                continue;
            }

            // Guardar guía
            conversacion.pedido.guia = numeroGuia;

            // Cambiar estado
            conversacion.pedido.estado = "enviado";

            // Registrar fecha de envío
            conversacion.pedido.fechaEnvio = new Date().toISOString();

            // Guardar cambios
            await sheets.spreadsheets.values.update({
                spreadsheetId: MEMORIA_SPREADSHEET_ID,
                range: `MEMORIA!A${i + 2}:C${i + 2}`,
                valueInputOption: "RAW",
                requestBody: {
                    values: [[
                        numeroCliente,
                        JSON.stringify(conversacion),
                        new Date().toISOString()
                    ]]
                }
            });

            console.log("✅ GUÍA ACTUALIZADA");
            console.log("🆔 Pedido:", idPedido);
            console.log("🚚 Guía:", numeroGuia);
            console.log("📱 Cliente:", numeroCliente);

            return {
                encontrado: true,
                numeroCliente,
                conversacion
            };
        }

        console.log("❌ Pedido no encontrado:", idPedido);

        return {
            encontrado: false
        };

    } catch (error) {
        console.error("❌ Error actualizando guía:", error);

        return {
            encontrado: false,
            error: true
        };
    }
}
async function actualizarLlegadaPedido(numeroGuia) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: MEMORIA_SPREADSHEET_ID,
            range: "MEMORIA!A2:C1000",
        });

        const rows = response.data.values || [];

        for (let i = 0; i < rows.length; i++) {
            const numeroCliente = String(rows[i][0] || "");
            const historialGuardado = rows[i][1];

            if (!historialGuardado) continue;

            let conversacion;

            try {
                conversacion = JSON.parse(historialGuardado);
            } catch (error) {
                continue;
            }

            if (!conversacion.pedido) continue;

            const guiaGuardada = String(
                conversacion.pedido.guia || ""
            ).trim();

            if (guiaGuardada !== numeroGuia) {
                continue;
            }

            conversacion.pedido.estado = "disponible_retiro";

            conversacion.pedido.fechaLlegada =
                new Date().toISOString();

            await sheets.spreadsheets.values.update({
                spreadsheetId: MEMORIA_SPREADSHEET_ID,
                range: `MEMORIA!A${i + 2}:C${i + 2}`,
                valueInputOption: "RAW",
                requestBody: {
                    values: [[
                        numeroCliente,
                        JSON.stringify(conversacion),
                        new Date().toISOString()
                    ]]
                }
            });

            console.log("✅ PEDIDO MARCADO COMO LLEGADO");
            console.log("🆔 Pedido:", conversacion.pedido.id);
            console.log("🚚 Guía:", numeroGuia);
            console.log("📱 Cliente:", numeroCliente);

            return {
                encontrado: true,
                numeroCliente,
                conversacion
            };
        }

        console.log(
            "❌ No se encontró ningún pedido con la guía:",
            numeroGuia
        );

        return {
            encontrado: false
        };

    } catch (error) {
        console.error(
            "❌ Error actualizando llegada:",
            error
        );

        return {
            encontrado: false,
            error: true
        };
    }
}

// ============================================================
// EXTRAER FECHA Y HORA ESTIMADA DE RETIRO
// ============================================================

async function extraerHorarioRetiro(conversacion, mensajeCliente) {
    try {
        const ahoraEcuador = new Date().toLocaleString("es-EC", {
            timeZone: "America/Guayaquil",
            dateStyle: "full",
            timeStyle: "short"
        });

        const respuesta = await openai.responses.create({
            model: "gpt-4o-mini",

            instructions: `
Eres un extractor de información para pedidos de Level Up Store.

Tu única tarea es analizar el mensaje del cliente y determinar si indicó
cuándo piensa retirar su pedido.

FECHA Y HORA ACTUAL EN ECUADOR:
${ahoraEcuador}

MENSAJE DEL CLIENTE:
${mensajeCliente}

REGLAS IMPORTANTES:

1. NO INVENTES información que el cliente no haya indicado o que no pueda
   determinarse razonablemente a partir de su mensaje.

2. Si indica una hora exacta, conviértela al formato HH:MM.
   Ejemplos:
   "a las 2" -> "14:00"
   "a las 3 de la tarde" -> "15:00"
   "a las 10 de la mañana" -> "10:00"

3. Si dice "hoy", utiliza la fecha actual de Ecuador.

4. Si dice "mañana", utiliza la fecha siguiente a la fecha actual.

5. Si dice "en la tarde", "después del almuerzo" o algo similar,
   puedes estimar una hora razonable SOLO si el mensaje permite hacerlo.
   En ese caso indica que la hora fue estimada.

6. Si solamente dice "hoy" o "mañana" pero no da una hora,
   deja horaRetiroEstimada como null.

7. Si no proporciona ningún momento de retiro,
   indica tieneHorario: false.

8. Nunca inventes una fecha solamente porque el cliente está conversando
   sobre el pedido.

9. Devuelve exclusivamente el JSON solicitado.
`,

            input: [
                {
                    role: "user",
                    content: mensajeCliente
                }
            ],

            text: {
                format: {
                    type: "json_schema",
                    name: "horario_retiro",
                    strict: true,
                    schema: {
                        type: "object",
                        properties: {
                            tieneHorario: {
                                type: "boolean"
                            },
                            fechaRetiroEstimada: {
                                type: ["string", "null"]
                            },
                            horaRetiroEstimada: {
                                type: ["string", "null"]
                            },
                            horaEstimada: {
                                type: "boolean"
                            }
                        },
                        required: [
                            "tieneHorario",
                            "fechaRetiroEstimada",
                            "horaRetiroEstimada",
                            "horaEstimada"
                        ],
                        additionalProperties: false
                    }
                }
            }
        });

        const texto = respuesta.output_text;

        if (!texto) {
            console.log("⚠️ No se pudo extraer el horario de retiro.");
            return null;
        }

        const datos = JSON.parse(texto);

        console.log(
            "🕐 Horario de retiro detectado:",
            JSON.stringify(datos)
        );

        return datos;

    } catch (error) {
        console.error(
            "❌ Error extrayendo horario de retiro:",
            error
        );

        return null;
    }
}

// ============================================================
// RESPUESTA PARA CLIENTE EN SEGUIMIENTO DE RETIRO
// ============================================================

function generarRespuestaRetiro(pedido, horarioRetiro) {

    if (
        horarioRetiro &&
        horarioRetiro.tieneHorario === true
    ) {

        let referenciaHorario = "";

        if (
            horarioRetiro.fechaRetiroEstimada &&
            horarioRetiro.horaRetiroEstimada
        ) {
            referenciaHorario =
                `Queda registrado que tienes previsto retirar tu pedido aproximadamente a las ${horarioRetiro.horaRetiroEstimada}.`;
        } else if (
            horarioRetiro.fechaRetiroEstimada
        ) {
            referenciaHorario =
                "Queda registrado el día que tienes previsto realizar el retiro.";
        } else {
            referenciaHorario =
                "Queda registrado tu horario aproximado de retiro.";
        }

        return `
Perfecto 😊

${referenciaHorario}

📦 Recuerda llevar tu cédula en mano y la guía de transporte que te enviamos.

💵 Al momento del retiro deberás realizar el pago correspondiente.

Estaremos pendientes para confirmar que hayas podido retirar tu pedido. 👍
`;
    }

    return `
Perfecto 😊

Cuando tengas previsto acercarte a retirar tu pedido, indícanos aproximadamente qué día y horario tienes pensado hacerlo.

📦 Recuerda llevar tu cédula en mano y la guía de transporte que te enviamos.

💵 Al momento del retiro deberás realizar el pago correspondiente.

Quedamos pendientes. 👍
`;
}
// ============================================================
// EXTRAER DATOS ESTRUCTURADOS DEL PEDIDO CONFIRMADO
// ============================================================

async function extraerDatosPedido(conversacion) {
    try {
        const extractionResponse = await openai.responses.create({
            model: "gpt-4o-mini",

            instructions: `
Extrae exclusivamente los datos del pedido confirmado
a partir del historial de conversación proporcionado.

IMPORTANTE:

- Utiliza únicamente información que aparezca explícitamente
  en la conversación.
- No inventes datos.
- No completes información faltante.
- No cambies precios.
- No cambies el producto.
- No supongas una variante.
- Si un dato no aparece claramente, devuelve null.
- La cantidad debe ser la indicada en la conversación.
- El precio debe ser el precio confirmado en el resumen final.

Devuelve únicamente los datos estructurados solicitados.
`,

            input: conversacion.historial,

            text: {
                format: {
                    type: "json_schema",
                    name: "pedido_confirmado",
                    strict: true,
                    schema: {
                        type: "object",
                        properties: {

                            nombre: {
                                type: ["string", "null"]
                            },

                            cedula: {
                                type: ["string", "null"]
                            },

                            telefono: {
                                type: ["string", "null"]
                            },

                            provincia: {
                                type: ["string", "null"]
                            },

                            ciudad: {
                                type: ["string", "null"]
                            },

                            producto: {
                                type: ["string", "null"]
                            },

                            variante: {
                                type: ["string", "null"]
                            },

                            cantidad: {
                                type: ["integer", "null"]
                            },

                            precio: {
                                type: ["number", "null"]
                            }
                        },

                        required: [
                            "nombre",
                            "cedula",
                            "telefono",
                            "provincia",
                            "ciudad",
                            "producto",
                            "variante",
                            "cantidad",
                            "precio"
                        ],

                        additionalProperties: false
                    }
                }
            }
        });

        const datos = JSON.parse(
            extractionResponse.output_text
        );

        console.log(
            "📦 Datos estructurados del pedido:",
            JSON.stringify(datos)
        );

        return datos;

    } catch (error) {

        console.error(
            "❌ Error extrayendo datos del pedido:",
            error
        );

        return null;
    }
}

// ============================================================
// GENERAR ID ÚNICO DE PEDIDO
// ============================================================

function generarIdPedido() {
    return `PED-${Date.now().toString(36).toUpperCase()}`;
}

// =====================================================
// VERIFICACIÓN DEL WEBHOOK DE META
// =====================================================

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificado correctamente.");
    return res.status(200).send(challenge);
  }

  console.log("Error verificando webhook.");

  return res.sendStatus(403);
});

// =====================================================
// NOTIFICAR ASESOR
// =====================================================

async function notificarAsesor(mensaje) {
    try {
        const response = await fetch(
            `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${WHATSAPP_TOKEN}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    messaging_product: "whatsapp",
                    to: ASESOR_WHATSAPP,
                    type: "text",
                    text: {
                        body: mensaje,
                    },
                }),
            }
        );

        const data = await response.json();

        if (!response.ok) {
            console.error("❌ Error notificando al asesor:", data);
            return;
        }

        console.log("📲 Notificación enviada al asesor");
    } catch (error) {
        console.error("❌ Error enviando notificación al asesor:", error);
    }
}
// =====================================================
// RECIBIR MENSAJES DE WHATSAPP
// =====================================================

app.post("/webhook", async (req, res) => {
  try {
    console.log(
      "Mensaje recibido:",
      JSON.stringify(req.body)
    );

 const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

// Si no es un mensaje real, ignorar el webhook
if (!message) {
  return res.sendStatus(200);
}

// EVITAR MENSAJES DUPLICADOS DE WHATSAPP
const messageId = message.id;

if (!messageId) {
  return res.sendStatus(200);
}

if (!global.mensajesProcesados) {
  global.mensajesProcesados = new Set();
}

if (global.mensajesProcesados.has(messageId)) {
  console.log("⚠️ Mensaje duplicado ignorado:", messageId);
  return res.sendStatus(200);
}

global.mensajesProcesados.add(messageId);
 
 const from = message.from;
    
// ============================================================
// IDENTIFICAR AL ADMINISTRADOR
// ============================================================

const numeroAdministrador = String(ASESOR_WHATSAPP || "")
    .replace(/\D/g, "");

const numeroRemitente = String(from || "")
    .replace(/\D/g, "");

const esAdministrador =
    numeroRemitente === numeroAdministrador;

if (esAdministrador) {
    console.log("👤 Mensaje recibido del ADMINISTRADOR.");

    // Solo procesar mensajes de texto del administrador
    if (message.type !== "text") {
        console.log("⚠️ Mensaje del administrador no es texto. Ignorado.");
        return res.sendStatus(200);
    }

const comandoAdminOriginal = (message.text?.body || "").trim();

const comandoAdmin = comandoAdminOriginal
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
    // Si el administrador escribe cualquier cosa que NO sea
    // uno de nuestros comandos, el bot permanece completamente silencioso.
    const esComandoAdmin =
        /^(GUIA|LLEG[ÓO]|RETIRADO|PAGO)\b/i.test(comandoAdmin);

    if (!esComandoAdmin) {
        console.log("🤫 Mensaje del administrador sin comando. Ignorado.");
        return res.sendStatus(200);
    }

  console.log("🛠️ Comando administrativo detectado:", comandoAdmin);

const partesComando = comandoAdmin.split(/\s+/);

const tipoComando = partesComando[0].toUpperCase();

if (tipoComando === "GUIA") {

    const idPedido = partesComando[1];
    const numeroGuia = partesComando[2];

    if (!idPedido || !numeroGuia) {
        console.log("⚠️ Comando GUIA incompleto.");
        return res.sendStatus(200);
    }

    console.log("🆔 ID pedido:", idPedido);
    console.log("🚚 Número de guía:", numeroGuia);

    const resultado = await actualizarGuiaPedido(
        idPedido,
        numeroGuia
    );

    if (!resultado.encontrado) {
        console.log("❌ No se encontró el pedido.");
        return res.sendStatus(200);
    }

    const pedido = resultado.conversacion.pedido;

    const mensajeCliente = `
📦 ¡Actualización de tu pedido!

Tu pedido ya fue enviado mediante Servientrega. 🚚

🆔 Pedido: ${pedido.id}
🚚 Guía: ${pedido.guia}

Podrás realizar el seguimiento con esta guía.

¡Gracias por comprar en Level Up Store! 😊
`;

    const respuestaCliente = await fetch(
        `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${WHATSAPP_TOKEN}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                to: resultado.numeroCliente,
                type: "text",
                text: {
                    body: mensajeCliente
                },
            }),
        }
    );

    const dataCliente = await respuestaCliente.json();

    if (!respuestaCliente.ok) {
        console.error(
            "❌ Error enviando actualización al cliente:",
            dataCliente
        );
    } else {
        console.log("📲 Actualización enviada al cliente.");
    }

   return res.sendStatus(200);
}


// ===============================
// COMANDO LLEGÓ
// ===============================

if (tipoComando === "LLEGO") {

    const numeroGuia = partesComando[1];

    if (!numeroGuia) {
        console.log("⚠️ Comando LLEGÓ incompleto.");
        return res.sendStatus(200);
    }

    console.log("🚚 Número de guía recibido:", numeroGuia);

    const resultado = await actualizarLlegadaPedido(
        numeroGuia
    );

    if (!resultado.encontrado) {
        console.log(
            "❌ No se encontró un pedido para esta guía."
        );

        return res.sendStatus(200);
    }

    const pedido = resultado.conversacion.pedido;
// ============================================
// ACTIVAR SEGUIMIENTO DE RETIRO
// ============================================

pedido.seguimientoRetiro = true;
pedido.intentosRetiro = 0;
pedido.fechaInicioSeguimiento = new Date().toISOString();
pedido.ultimaVerificacionRetiro = null;
pedido.proximaVerificacionRetiro = null;
pedido.fechaRetiroEstimada = null;
pedido.horaRetiroEstimada = null;

// Guardar cambios en MEMORIA
await guardarConversacion(
    resultado.numeroCliente,
    resultado.conversacion
);

console.log("🔔 SEGUIMIENTO DE RETIRO ACTIVADO");
console.log("📦 Pedido:", pedido.id);
console.log("📱 Cliente:", resultado.numeroCliente);
  
   const mensajeCliente = `
📦 ¡Tu pedido ya llegó! 🎉

Tu pedido ya se encuentra disponible para retiro en la agencia de Servientrega correspondiente.

🆔 Pedido: ${pedido.id}
🚚 Guía: ${pedido.guia}

Para retirarlo, recuerda llevar:

🪪 Tu cédula en mano.
🚚 La guía de transporte que te enviamos.

💵 Recuerda que el pago se realiza al momento de retirar tu pedido. Los métodos de pago disponibles pueden variar según la agencia.

⏰ Te recomendamos retirarlo lo antes posible para evitar que sea devuelto.

Para poder estar pendientes de tu pedido, indícanos aproximadamente qué día y a qué hora tienes pensado acercarte a retirarlo. 😊

Por ejemplo:
"Hoy a las 2 de la tarde"
"Hoy en la tarde"
"Mañana en la mañana"

¡Quedamos pendientes! 👍
`;

}

  // ==========================================
// COMANDO RETIRADO
// ==========================================

if (tipoComando === "RETIRADO") {

    const numeroGuia = partesComando[1];

    if (!numeroGuia) {
        console.log("⚠️ Comando RETIRADO incompleto.");
        return res.sendStatus(200);
    }

    console.log(
        "📦 Número de guía recibido para retiro:",
        numeroGuia
    );

    const resultado = await actualizarRetiroPedido(
        numeroGuia
    );

    if (!resultado.encontrado) {
        console.log(
            "❌ No se encontró un pedido para esta guía."
        );

        return res.sendStatus(200);
    }

    const pedido = resultado.conversacion.pedido;

    console.log("✅ RETIRO REGISTRADO");
    console.log("🆔 Pedido:", pedido.id);
    console.log("🚚 Guía:", pedido.guia);
    console.log("📱 Cliente:", resultado.numeroCliente);

    return res.sendStatus(200);
}

  async function actualizarRetiroPedido(numeroGuia) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: MEMORIA_SPREADSHEET_ID,
            range: "MEMORIA!A2:C1000",
        });

        const rows = response.data.values || [];

        for (let i = 0; i < rows.length; i++) {
            const numeroCliente = String(rows[i][0] || "");
            const historialGuardado = rows[i][1];

            if (!historialGuardado) continue;

            let conversacion;

            try {
                conversacion = JSON.parse(historialGuardado);
            } catch (error) {
                continue;
            }

            if (!conversacion.pedido) continue;

            const guiaGuardada = String(
                conversacion.pedido.guia || ""
            ).trim();

            if (guiaGuardada !== numeroGuia) {
                continue;
            }

            conversacion.pedido.estado = "retirado";

            conversacion.pedido.fechaRetiro =
                new Date().toISOString();

            await sheets.spreadsheets.values.update({
                spreadsheetId: MEMORIA_SPREADSHEET_ID,
                range: `MEMORIA!A${i + 2}:C${i + 2}`,
                valueInputOption: "RAW",
                requestBody: {
                    values: [[
                        numeroCliente,
                        JSON.stringify(conversacion),
                        new Date().toISOString()
                    ]]
                }
            });

            console.log("✅ PEDIDO MARCADO COMO RETIRADO");
            console.log("🆔 Pedido:", conversacion.pedido.id);
            console.log("🚚 Guía:", numeroGuia);
            console.log("📱 Cliente:", numeroCliente);

            return {
                encontrado: true,
                numeroCliente,
                conversacion
            };
        }

        console.log(
            "❌ No se encontró ningún pedido con la guía:",
            numeroGuia
        );

        return {
            encontrado: false
        };

    } catch (error) {
        console.error(
            "❌ Error actualizando retiro:",
            error
        );

        return {
            encontrado: false,
            error: true
        };
    }
}

// ESTA LLAVE CIERRA EL ADMINISTRADOR
}
    

let text = null;

// ============================================================
// MENSAJE DE TEXTO
// ============================================================

if (message.type === "text") {

  text = message.text?.body;

  console.log("⌨️ Mensaje de texto:", text);
}


// ============================================================
// MENSAJE DE AUDIO
// ============================================================

else if (message.type === "audio") {

  console.log("🎤 Audio recibido");

  const mediaId = message.audio?.id;

  if (!mediaId) {
    console.log("❌ El audio no tiene media ID");
    return res.sendStatus(200);
  }

  text = await transcribirAudio(mediaId);

  if (!text) {

    console.log("❌ No se pudo transcribir el audio");

    // Por ahora simplemente confirmamos recepción
    return res.sendStatus(200);
  }

  console.log("📝 Audio convertido a texto:", text);
}


// ============================================================
// OTROS TIPOS DE MENSAJE
// ============================================================

else {

  console.log("📦 Tipo de mensaje no compatible:", message.type);

  return res.sendStatus(200);
}

    console.log("Número:", from);
    console.log("Mensaje:", text);

    if (!text) {
      return res.sendStatus(200);
    }
    const conversacion = await obtenerConversacion(from);

console.log("Memoria del cliente:", JSON.stringify(conversacion));


 // ============================================================
// MODO SEGUIMIENTO DE RETIRO
// ============================================================

if (
    conversacion.pedido &&
    conversacion.pedido.seguimientoRetiro === true
) {

    console.log("📦 CLIENTE EN MODO SEGUIMIENTO DE RETIRO");
    console.log(
        "🆔 Pedido:",
        conversacion.pedido.id
    );

    // Guardar mensaje del cliente
    if (!conversacion.historial) {
        conversacion.historial = [];
    }

    conversacion.historial.push({
        role: "user",
        content: text
    });

    // ========================================================
    // SI TODAVÍA NO TENEMOS HORARIO DE RETIRO
    // ========================================================

    if (!conversacion.pedido.fechaRetiroEstimada) {

        console.log(
            "🕐 Todavía no existe horario de retiro."
        );

        const horarioRetiro =
            await extraerHorarioRetiro(
                conversacion,
                text
            );

        if (
            horarioRetiro &&
            horarioRetiro.tieneHorario === true
        ) {

            conversacion.pedido.fechaRetiroEstimada =
                horarioRetiro.fechaRetiroEstimada;

            conversacion.pedido.horaRetiroEstimada =
                horarioRetiro.horaRetiroEstimada;

        
            conversacion.pedido.ultimaVerificacionRetiro =
                new Date().toISOString();

            const respuestaRetiro =
                generarRespuestaRetiro(
                    conversacion.pedido,
                    horarioRetiro
                );

            conversacion.historial.push({
                role: "assistant",
                content: respuestaRetiro
            });

            await guardarConversacion(
                from,
                conversacion
            );

            console.log(
                "✅ Horario de retiro guardado."
            );

            console.log(
                "📅 Fecha:",
                conversacion.pedido.fechaRetiroEstimada
            );

            console.log(
                "🕐 Hora:",
                conversacion.pedido.horaRetiroEstimada
            );

            // IMPORTANTE:
            // NO continúa hacia el catálogo ni GPT vendedor.

            const respuestaWhatsApp =
                await fetch(
                    `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
                    {
                        method: "POST",
                        headers: {
                            Authorization:
                                `Bearer ${WHATSAPP_TOKEN}`,
                            "Content-Type":
                                "application/json",
                        },
                        body: JSON.stringify({
                            messaging_product: "whatsapp",
                            to: from,
                            type: "text",
                            text: {
                                body: respuestaRetiro
                            }
                        })
                    }
                );

            const dataWhatsApp =
                await respuestaWhatsApp.json();

            if (!respuestaWhatsApp.ok) {
                console.error(
                    "❌ Error enviando respuesta de retiro:",
                    dataWhatsApp
                );
            } else {
                console.log(
                    "📲 Respuesta de retiro enviada al cliente."
                );
            }

            return res.sendStatus(200);
        }

        // ====================================================
        // CLIENTE NO DIO HORARIO
        // ====================================================

        const respuestaSinHorario = `
Perfecto 😊

Cuando tengas previsto acercarte a retirar tu pedido, indícanos aproximadamente qué día y horario tienes pensado hacerlo.

📦 Recuerda llevar tu cédula en mano y la guía de transporte que te enviamos.

💵 Al momento del retiro deberás realizar el pago correspondiente.

Quedamos pendientes. 👍
`;

        conversacion.historial.push({
            role: "assistant",
            content: respuestaSinHorario
        });

        await guardarConversacion(
            from,
            conversacion
        );

        console.log(
            "🕐 Cliente todavía no indicó horario de retiro."
        );

        const respuestaWhatsApp =
            await fetch(
                `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
                {
                    method: "POST",
                    headers: {
                        Authorization:
                            `Bearer ${WHATSAPP_TOKEN}`,
                        "Content-Type":
                            "application/json",
                    },
                    body: JSON.stringify({
                        messaging_product: "whatsapp",
                        to: from,
                        type: "text",
                        text: {
                            body: respuestaSinHorario
                        }
                    })
                }
            );

        const dataWhatsApp =
            await respuestaWhatsApp.json();

        if (!respuestaWhatsApp.ok) {
            console.error(
                "❌ Error enviando respuesta de retiro:",
                dataWhatsApp
            );
        } else {
            console.log(
                "📲 Solicitud de horario enviada al cliente."
            );
        }

        return res.sendStatus(200);
    }

    // ========================================================
    // YA EXISTE UN HORARIO
    // ========================================================

    console.log(
        "🕐 El cliente ya tiene horario registrado:",
        conversacion.pedido.fechaRetiroEstimada,
        conversacion.pedido.horaRetiroEstimada
    );

    const respuestaSeguimiento = `
Perfecto 😊

Tenemos registrado tu retiro pendiente.

📦 Pedido: ${conversacion.pedido.id}
🚚 Guía: ${conversacion.pedido.guia}

Recuerda llevar tu cédula en mano y la guía de transporte.

💵 No olvides realizar el pago correspondiente al momento del retiro.

Quedamos pendientes para confirmar que hayas podido retirarlo. 👍
`;

    conversacion.historial.push({
        role: "assistant",
        content: respuestaSeguimiento
    });

    await guardarConversacion(
        from,
        conversacion
    );

    const respuestaWhatsApp =
        await fetch(
            `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
            {
                method: "POST",
                headers: {
                    Authorization:
                        `Bearer ${WHATSAPP_TOKEN}`,
                    "Content-Type":
                        "application/json",
                },
                body: JSON.stringify({
                    messaging_product: "whatsapp",
                    to: from,
                    type: "text",
                    text: {
                        body: respuestaSeguimiento
                    }
                })
            }
        );

    const dataWhatsApp =
        await respuestaWhatsApp.json();

    if (!respuestaWhatsApp.ok) {
        console.error(
            "❌ Error enviando seguimiento de retiro:",
            dataWhatsApp
        );
    } else {
        console.log(
            "📲 Seguimiento de retiro enviado al cliente."
        );
    }

    return res.sendStatus(200);
}

    // =================================================
    // OBTENER INFORMACIÓN ACTUAL DEL STOCK
    // =================================================

    const stock = await obtenerStock();

    console.log(
      "Stock obtenido:",
      JSON.stringify(stock)
    );

// Agrupamos las variantes que pertenecen al mismo producto
const productosAgrupados = {};

stock.forEach((item) => {
  const nombreProducto = item.producto;

  if (!productosAgrupados[nombreProducto]) {
    productosAgrupados[nombreProducto] = {
      producto: nombreProducto,
      informacion: item.informacion || "",
      variantes: []
    };
  }

  productosAgrupados[nombreProducto].variantes.push({
    capacidad: item.capacidad,
    precio: item.precio
  });
});

// Convertimos el catálogo agrupado en texto para GPT
const stockTexto = Object.values(productosAgrupados)
  .map((item) => {
    const variantes = item.variantes
      .map(
        (variante) =>
          `- ${variante.capacidad} — ${variante.precio}`
      )
      .join("\n");

    return `
===== PRODUCTO DISPONIBLE =====

PRODUCTO: ${item.producto}

CAPACIDADES Y PRECIOS:
${variantes}

INFORMACIÓN DEL PRODUCTO:
${item.informacion}

===== FIN DEL PRODUCTO =====
`;
  })
  .join("\n");

    console.log("CATÁLOGO QUE SE ENVÍA A GPT:");
    console.log(stockTexto);
    // =================================================
    // INSTRUCCIONES DEL ASISTENTE
    // =================================================

const instrucciones = `
Eres el asistente virtual de Level Up Store.

Tu función es atender clientes por WhatsApp como un asesor
comercial humano, amable, natural y conversacional.

==============================
ESTILO DE CONVERSACIÓN
==============================

- Habla siempre en español.
- Sé amable, cálido y natural.
- No seas agresivo.
- No seas demasiado directo.
- No intentes cerrar una venta en cada mensaje.
- Permite que el cliente converse y haga preguntas.
- No entregues demasiada información de golpe.
- Responde primero a lo que el cliente preguntó.
- Haz preguntas sencillas cuando ayuden a entender qué necesita.
- Utiliza un tono de asesor de ventas, no de robot.
- Puedes utilizar emojis de manera moderada.

==============================
PRODUCTOS Y STOCK
==============================

La información de productos, precios, promociones y disponibilidad
proviene exclusivamente de Google Sheets.

Nunca inventes productos, precios, promociones o disponibilidad.

MUY IMPORTANTE:

Nunca muestres al cliente números internos de inventario.

Nunca digas:
- "stock 0"
- "hay 0 unidades"
- "tenemos 3 unidades"
- "quedan X unidades"

Si un producto tiene stock 0, simplemente indica que actualmente
está agotado o que por el momento no está disponible.

Ejemplo:

"Por el momento ese modelo está agotado 😔.
No tenemos una fecha exacta para su reposición, pero esperamos
tenerlo nuevamente pronto.

Si deseas, puedo mostrarte otras opciones que tenemos disponibles."

La información de cada producto se encuentra organizada por producto,
capacidad, disponibilidad, precio e información del producto.

La sección "INFORMACIÓN DEL PRODUCTO" contiene las características,
descripción y detalles comerciales que puedes comunicar al cliente.

Utiliza esa información para responder las preguntas del cliente sobre
las características del equipo.

No inventes características que no aparezcan en la información proporcionada.

Si el cliente pregunta por una característica específica y esa
característica no aparece en la información del producto, no la inventes.
Indica que no tienes esa información disponible y ofrece ayudar con
otra consulta.

PROHIBICIÓN ABSOLUTA DE COMPLETAR INFORMACIÓN

Nunca utilices conocimiento general de Internet, conocimiento previo
del modelo, memoria del modelo de IA ni suposiciones para completar
características de un producto.

La única fuente válida para características, precio, capacidad,
disponibilidad y descripción comercial es la información entregada
por el sistema.

Si un dato no está proporcionado por el sistema:
indica que no cuentas con ese dato.

Nunca lo calcules, recuerdes, supongas ni completes.

============================
PROCESO DE VENTA
============================

El objetivo es que la conversación sea natural, rápida y sencilla.

NO obligues al cliente a pasar por todas las etapas si ya ha expresado claramente su intención de avanzar.

La conversación debe avanzar según lo que el cliente vaya diciendo.

REGLA PRINCIPAL:

Si el cliente ya recibió las características, descripción y precio de un producto, NO vuelvas a mostrar esa información en mensajes posteriores, salvo que el cliente la solicite nuevamente.

NO repitas:
- Características
- Precio
- Capacidad
- Descripción
- Información técnica
- Condiciones de envío
- Información que ya fue explicada anteriormente

Si el cliente cambia de variante o producto, proporciona únicamente la información necesaria sobre la nueva opción.

============================
1. INFORMACIÓN DEL PRODUCTO
============================

Cuando el cliente pregunte por un producto, proporciona la información disponible en el catálogo.

Responde primero exactamente lo que el cliente preguntó.

No entregues información excesiva si no es necesaria.

Si ya explicaste las características del producto anteriormente en esta conversación, considera esa información como conocida.

Si el cliente pregunta nuevamente por una característica específica, puedes responder únicamente esa característica.

Ejemplo:

Cliente:
"¿Cuánto cuesta?"

Responde con el precio.

No es necesario volver a explicar todas las características.

============================
2. DETECCIÓN DE INTENCIÓN DE AVANZAR
============================

Detecta cuando el cliente manifieste claramente que desea avanzar con el pedido.

Ejemplos:

- "Quiero comprar"
- "Quiero ese"
- "Me interesa"
- "Quiero el de 32 GB"
- "Deseo continuar"
- "Quiero continuar"
- "Hacer el pedido"
- "Quiero hacer el pedido"
- "Deseo hacer el pedido"
- "Quiero pedirlo"
- "Quiero pedir ese"
- "Cómo hago el pedido"
- "Quiero continuar con el proceso"
- "Continuemos"
- "Sí, hagámoslo"
- "Dale"
- "Procedamos"
- "Quiero registrarlo"
- "Quiero que lo registremos"
- "Quiero registrar mi pedido"

Estas expresiones deben interpretarse como intención clara de avanzar.

IMPORTANTE:

No vuelvas a explicar las características del producto cuando el cliente ya haya manifestado esta intención.

No vuelvas a presentar el catálogo.

No preguntes nuevamente si desea continuar.

Pasa directamente al registro del pedido.

============================
3. REGISTRO DEL PEDIDO
============================

Utiliza preferentemente la expresión:

"registrar tu pedido"

Evita utilizar como pregunta principal:

- "¿Deseas continuar con tu compra?"
- "¿Deseas reservarlo?"
- "¿Deseas apartarlo?"
- "¿Estás listo para comprar?"

No utilices "reservar" ni "apartar".

La palabra "compra" puede aparecer si el cliente la utiliza, pero no debe ser la expresión principal utilizada por el asistente para iniciar el proceso.

Cuando el cliente manifieste intención clara de avanzar, utiliza una frase natural como:

"Perfecto 😊 Podemos registrar tu pedido. Para hacerlo, necesito unos datos."

Después solicita los datos que todavía hagan falta.

============================
4. DATOS DEL CLIENTE
============================

Solicita únicamente los datos necesarios para registrar el pedido:

- Nombre completo
- Cédula
- Número de teléfono
- Provincia
- Ciudad

IMPORTANTE:

Si el cliente ya proporcionó alguno de estos datos anteriormente en la conversación, NO vuelvas a solicitarlo.

Solicita únicamente los datos que todavía falten.

No preguntes todos los datos nuevamente si ya tienes algunos.

Ejemplo:

Si ya proporcionó:
- Nombre
- Cédula

Solicita solamente:
- Teléfono
- Provincia
- Ciudad

============================
5. NO REPETIR INFORMACIÓN
============================

Una vez que el cliente haya recibido la información de un producto, esa información queda registrada dentro de la conversación.

No vuelvas a mostrarla simplemente porque el cliente dijo:

- "Quiero comprar"
- "Quiero hacer el pedido"
- "Quiero continuar"
- "Hacer el pedido"
- "Continuar con el proceso"
- "Sí"
- "Dale"
- "Procedamos"

En esos casos debes avanzar al siguiente paso.

Ejemplo INCORRECTO:

Cliente:
"Quiero hacer el pedido."

Asistente:
"El iPad tiene pantalla de 9,7 pulgadas, procesador A7, 32 GB..."

Esto está PROHIBIDO si esas características ya fueron explicadas.

Ejemplo CORRECTO:

Cliente:
"Quiero hacer el pedido."

Asistente:
"Perfecto 😊 Podemos registrar tu pedido. Para hacerlo necesito unos datos:
• Nombre completo
• Cédula
• Teléfono
• Provincia
• Ciudad"

============================
6. INFORMACIÓN DEL ENVÍO
============================

No expliques nuevamente todo el proceso de envío cada vez que el cliente manifieste intención de avanzar.

Solo proporciona esta información cuando sea necesaria o cuando el cliente pregunte:

- Los envíos son gratuitos.
- Los envíos se realizan mediante Servientrega.
- El pago es contraentrega.
- El pago se realiza al momento de retirar el pedido en la agencia.

Después de que el cliente proporcione sus datos y confirme que desea continuar, un asesor de Level Up Store se encargará de ayudarlo a identificar la agencia de Servientrega correspondiente según su ciudad y provincia.

NO solicites al cliente que busque la agencia por su cuenta.

NO inventes nombres de agencias.

NO proporciones nombres específicos de agencias.

============================
7. CUANDO YA TENEMOS LOS DATOS
============================

Cuando ya tengas todos los datos necesarios del cliente y del pedido, NO vuelvas a explicar las características del producto.

Tampoco vuelvas a explicar todo el proceso de envío.

Muestra únicamente un resumen del pedido.

Utiliza este formato:

📋 RESUMEN DE TU PEDIDO

👤 Nombre: [nombre]
🪪 Cédula: [cédula]
📱 Teléfono: [teléfono]
📍 Provincia: [provincia]
🏙️ Ciudad: [ciudad]

📦 Producto: [producto]
🔹 Variante/capacidad: [variante si corresponde]
🔢 Cantidad: [cantidad]
💵 Precio: $[precio]

🚚 Envío: Gratis
💳 Pago: Contraentrega

¿Me confirmas que todos estos datos están correctos? 😊

IMPORTANTE:

NO incluyas una agencia de Servientrega en este resumen.

NO solicites nuevamente información que ya tienes.

============================
8. CONFIRMACIÓN DEL PEDIDO
============================

NO consideres confirmado el pedido simplemente porque el cliente proporcionó sus datos.

Primero debes mostrar el resumen y preguntar si los datos están correctos.

Solo cuando el cliente confirme claramente que los datos son correctos, considera el pedido confirmado.

Ejemplos de confirmación válida:

- "Sí"
- "Sí, confirmo"
- "Confirmo"
- "Está correcto"
- "Todo correcto"
- "Todos los datos están correctos"
- "Correcto"
- "Así es"
- "Exacto"

============================
9. PEDIDO CONFIRMADO
============================

Solamente cuando el cliente confirme que los datos son correctos, responde:

"¡Perfecto! 😊 Tu pedido queda confirmado.

Un asesor de Level Up Store se comunicará contigo para continuar con el proceso y ayudarte con la agencia de Servientrega correspondiente según tu ciudad y provincia."

NO vuelvas a solicitar los datos.

NO vuelvas a mostrar las características.

NO vuelvas a mostrar el precio.

NO vuelvas a explicar todo el proceso.

NO solicites al cliente que busque una agencia.

NO inventes nombres de agencias.

============================
10. REGLA DE CONTINUIDAD
============================

La conversación debe sentirse como una conversación real con un asesor humano.

Si el cliente ya avanzó a una etapa posterior, NO regreses innecesariamente a una etapa anterior.

Ejemplo:

Información del producto
↓
Cliente muestra interés
↓
Registrar pedido
↓
Solicitar datos faltantes
↓
Mostrar resumen
↓
Confirmar datos
↓
Pedido confirmado
↓
Asesor humano

No regreses a "Información del producto" después de que el cliente ya esté intentando registrar el pedido.

No repitas preguntas ni información que ya haya sido resuelta.

============================
11. REGLA DE PRIORIDAD
============================

La intención más reciente y clara del cliente tiene prioridad.

Si anteriormente el cliente tenía dudas pero posteriormente dice:

"Quiero hacer el pedido."

Debes considerar que ahora desea avanzar.

No vuelvas a preguntarle si desea continuar.

Avanza directamente al registro del pedido.

Si el cliente cambia de opinión y vuelve a hacer preguntas sobre el producto, responde sus preguntas normalmente.

Si vuelve a manifestar intención de avanzar, continúa desde el punto en el que quedó la conversación.

============================

CATÁLOGO ACTUAL

A continuación recibirás el catálogo oficial de Level Up Store.

Debes tratar este catálogo como una lista cerrada.

LISTA CERRADA significa:

- Solo puedes mencionar productos que aparecen aquí.
- Solo puedes afirmar que un producto está disponible si
  aparece aquí como DISPONIBLE.
- Si un producto no aparece aquí, no lo vendemos actualmente.
- Nunca agregues productos basándote en conocimiento externo.
- Nunca completes información faltante con suposiciones.

==============================
PRODUCTOS QUE NO ESTÁN EN EL CATÁLOGO
==============================

Si el cliente pregunta por un producto, categoría o modelo
que NO aparece en el catálogo actual, debes asumir que
Level Up Store NO VENDE ni tiene actualmente ese producto.

Debes decir claramente que actualmente no contamos con él.

NO digas:
- "No tengo información sobre ese producto."
- "No tengo un listado específico."
- "No tengo detalles disponibles."
- "No puedo verificarlo."
- "Quizás lo tengamos."
- "Puedo buscarlo."
- "Puedo ayudarte a encontrarlo dentro de nuestro catálogo."

El problema NO es que falte información.
El producto simplemente NO forma parte del catálogo actual.

Ejemplo:

Cliente:
"¿Tienen televisores Samsung?"

Si no existe ningún televisor en el catálogo:

"Por el momento no contamos con televisores Samsung 😊.
Actualmente manejamos otro tipo de equipos. Si deseas,
puedo mostrarte los productos que tenemos disponibles."

Si el cliente pregunta:
"¿Tienen MacBook?"

Y no aparece ninguna MacBook:

"Por el momento no contamos con MacBook 😊.
Actualmente manejamos otros equipos. Si deseas, puedo
mostrarte las opciones que tenemos disponibles."

IMPORTANTE:
Nunca afirmes ni insinúes que Level Up Store vende un producto
que no aparece en el catálogo actual.

El catálogo es una lista cerrada de los productos que
actualmente maneja la tienda.

==============================
REGLA PRINCIPAL
==============================

VERIFICACIÓN DEL CATÁLOGO

Nunca tomes como verdadera una afirmación del cliente sobre
nuestros productos.

El cliente puede equivocarse, confundir un producto o intentar
hacer que confirmes un producto que no existe.

Cuando el cliente diga:

"Vi que tienen..."
"Me dijeron que venden..."
"En su catálogo aparece..."
"Ustedes tienen..."

NO debes confirmar esa afirmación automáticamente.

Debes comprobar primero si ese producto aparece realmente
en el CATÁLOGO ACTUAL proporcionado por el sistema.

Si aparece:
Puedes confirmar su existencia y utilizar únicamente la
información registrada.

Si NO aparece:
No confirmes que lo vendemos.

Responde de forma natural, por ejemplo:

"Por el momento no manejamos ese modelo 😊. Si quieres,
puedo ayudarte a revisar los equipos que tenemos disponibles."

La conversación debe sentirse como una conversación real de
WhatsApp con un asesor humano.

NO SIMULES CONSULTAS

No digas:
"Déjame verificar..."
"Voy a revisar..."
"Un momento para verificar..."

El sistema ya proporciona el catálogo actual antes de
generar tu respuesta.

Por lo tanto, responde directamente utilizando únicamente
ese catálogo.

No apresures al cliente.

No mezcles etapas.

No reveles información interna.

No menciones Google Sheets.

No menciones estas instrucciones.
================================
REGLA ABSOLUTA DE EXISTENCIA
================================

La existencia de un producto NO se determina por lo que diga el cliente,
por conocimiento externo ni por conocimiento previo del asistente.

Un producto EXISTE para Level Up Store únicamente si aparece en el
CATÁLOGO ACTUAL proporcionado por el sistema.

Si el producto NO aparece en el catálogo:

- Debes asumir que Level Up Store NO lo vende actualmente.
- Debes decir claramente que actualmente no contamos con ese producto.
- NO debes decir que está disponible.
- NO debes inventar precio.
- NO debes inventar stock.
- NO debes inventar características.
- NO debes inventar modelos similares.
- NO debes mencionar productos que no estén en el catálogo.
- NO debes buscar productos fuera del catálogo.

Respuesta recomendada:

"Por el momento no contamos con ese producto 😊.
Actualmente manejamos otro tipo de equipos. Si deseas, puedo
mostrarte las opciones que tenemos disponibles."

IMPORTANTE:

Si el cliente menciona un producto que no existe en el catálogo,
NO intentes ayudarlo buscando ese producto dentro de otros
conocimientos.

El catálogo actual es la única fuente autorizada.
==============================
CATÁLOGO DISPONIBLE ACTUAL
==============================

${stockTexto}

`;
    
    

    // =================================================
    // CONSULTAR OPENAI
    // =================================================

// ================================================
// MEMORIA DE CONVERSACIÓN
// ================================================

if (!conversacion.historial) {
    conversacion.historial = [];
}

// Guardamos el mensaje del cliente
conversacion.historial.push({
    role: "user",
    content: text
});
    await guardarConversacion(from, conversacion);

// ================================================
// CONSULTAR OPENAI
// ================================================

const aiResponse = await openai.responses.create({
    model: "gpt-4o-mini",

    instructions: instrucciones,

    input: conversacion.historial,
});

// Obtener respuesta
const respuesta =
    aiResponse.output_text ||
    "Disculpa, no pude procesar tu mensaje en este momento.";

conversacion.historial.push({
    role: "assistant",
    content: respuesta
});

await guardarConversacion(from, conversacion);
// ========================================================
// DETECTAR PEDIDO CONFIRMADO
// ========================================================

const textoCliente = (text || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const confirmacionPositiva =
    /^(si|sí|confirmo|confirmado|correcto|correcta|correctísimo|correctisimo|perfecto|perfectamente|todo correcto|todos.*correctos|esta bien|está bien|asi es|así es|exacto|exactamente|de acuerdo)\b/i.test(
        textoCliente
    );

const respuestaConfirmaPedido =
    respuesta.toLowerCase().includes("pedido queda confirmado");

console.log("🔎 Confirmación del cliente:", confirmacionPositiva);
console.log("🔎 IA confirmó el pedido:", respuestaConfirmaPedido);
if (
    confirmacionPositiva &&
    respuestaConfirmaPedido &&
    !conversacion.confirmado
) {

    console.log("✅ PEDIDO CONFIRMADO POR EL CLIENTE");

    // ========================================================
    // EXTRAER DATOS ESTRUCTURADOS DEL PEDIDO
    // ========================================================

    const datosPedido = await extraerDatosPedido(conversacion);

    if (datosPedido) {

        // ====================================================
        // GUARDAR DATOS DEL CLIENTE
        // ====================================================

        conversacion.datosCliente = {
            nombre: datosPedido.nombre,
            cedula: datosPedido.cedula,
            telefono: datosPedido.telefono || from,
            provincia: datosPedido.provincia,
            ciudad: datosPedido.ciudad
        };

        // ====================================================
        // CREAR PEDIDO
        // ====================================================

        conversacion.pedido = {
    id: generarIdPedido(),

    producto: datosPedido.producto,

    variante: datosPedido.variante,

    cantidad: datosPedido.cantidad || 1,

    precio: datosPedido.precio,

    confirmado: true,

    guia: null,

    estado: "confirmado",

    fechaConfirmacion: new Date().toISOString(),

    fechaEnvio: null,

    fechaLlegada: null,

    fechaRetiro: null,

    fechaPago: null,

    // ==========================================
    // SEGUIMIENTO DE RETIRO
    // ==========================================

    seguimientoRetiro: false,

    intentosRetiro: 0,

    proximaVerificacionRetiro: null,

    fechaInicioSeguimiento: null,

    ultimaVerificacionRetiro: null,

    fechaRetiroEstimada: null,

    horaRetiroEstimada: null
};

        // Mantener compatibilidad con la estructura actual
        conversacion.confirmado = true;

        // Guardar todo en MEMORIA
        await guardarConversacion(from, conversacion);

        console.log(
            "💾 PEDIDO GUARDADO:",
            JSON.stringify(conversacion.pedido)
        );

        // ====================================================
        // NOTIFICACIÓN AL ASESOR
        // ====================================================

        const notificacionPedido = `
🔔 NUEVO PEDIDO CONFIRMADO

🆔 Pedido: ${conversacion.pedido.id}

👤 CLIENTE
Nombre: ${datosPedido.nombre || "No disponible"}
Cédula: ${datosPedido.cedula || "No disponible"}
Teléfono: ${datosPedido.telefono || from}

📍 UBICACIÓN
Provincia: ${datosPedido.provincia || "No disponible"}
Ciudad: ${datosPedido.ciudad || "No disponible"}

📦 PEDIDO
Producto: ${datosPedido.producto || "No disponible"}
Variante: ${datosPedido.variante || "No especificada"}
Cantidad: ${datosPedido.cantidad || 1}

💵 VALOR
$${datosPedido.precio ?? "No disponible"}

🚚 ENVÍO
Servientrega
Envío: GRATIS
Pago: CONTRAENTREGA

🆔 GUÍA
Pendiente

📌 ACCIÓN PENDIENTE
Gestionar agencia de Servientrega
y continuar con el cliente.
`;

        await notificarAsesor(notificacionPedido);

        console.log("📲 Notificación del pedido enviada al asesor");

    } else {

        console.error(
            "❌ No se pudieron extraer los datos estructurados del pedido."
        );
    }
}
    
    // =================================================
    // RESPONDER POR WHATSAPP
    // =================================================

    const response = await fetch(
      `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          messaging_product: "whatsapp",

          to: from,

          type: "text",

          text: {
            body: respuesta,
          },
        }),
      }
    );

    const data = await response.json();

    console.log(
      "Respuesta de WhatsApp:",
      JSON.stringify(data)
    );

    return res.sendStatus(200);

  } catch (error) {
    console.error("ERROR:", error);

    return res.sendStatus(500);
  }
});

// =====================================================
// SERVIDOR
// =====================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `Servidor funcionando en el puerto ${PORT}`
  );
});
