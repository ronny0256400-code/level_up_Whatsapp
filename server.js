const express = require("express");
const OpenAI = require("openai");
const { google } = require("googleapis");

const app = express();

app.use(express.json());

// =====================================================
// CONFIGURACIÓN OPENAI
// =====================================================

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =====================================================
// CONFIGURACIÓN WHATSAPP
// =====================================================

const VERIFY_TOKEN = "levelup_verification_2026";

const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

// =====================================================
// CONFIGURACIÓN GOOGLE SHEETS
// =====================================================

const SPREADSHEET_ID =
  "1geYhn1AtyV0n75MtaX1Zo1ka4qEEKtTrbiTkViLswR0";

const googleCredentials = JSON.parse(
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON
);

const auth = new google.auth.GoogleAuth({
  credentials: googleCredentials,
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
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
    spreadsheetId: SPREADSHEET_ID,
    range: "PAGINA DE STOCK!B2:G20",
  });

  const rows = response.data.values || [];

  return rows;
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
// RECIBIR MENSAJES DE WHATSAPP
// =====================================================

app.post("/webhook", async (req, res) => {
  try {
    console.log(
      "Mensaje recibido:",
      JSON.stringify(req.body)
    );

    const message =
      req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    // Si no es un mensaje válido, respondemos OK
    if (!message) {
      return res.sendStatus(200);
    }

    // Solo procesamos mensajes de texto
    if (message.type !== "text") {
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body;

    console.log("Número:", from);
    console.log("Mensaje:", text);

    if (!text) {
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

    // Convertimos las filas del Sheet en texto
    const stockTexto = stock
      .map((fila) => fila.join(" | "))
      .join("\n");

    // =================================================
    // INSTRUCCIONES DEL ASISTENTE
    // =================================================

    const instrucciones = `
Eres el asistente virtual de Level Up Store.

Atiendes clientes por WhatsApp de manera amable,
profesional, clara y natural.

Tu función principal es ayudar a los clientes con:

- Productos disponibles
- Precios
- Promociones
- Stock
- Características de los productos
- Disponibilidad
- Información básica sobre envíos

IMPORTANTE:

La información de productos, precios, stock y promociones
debe basarse EXCLUSIVAMENTE en la información proporcionada
en Google Sheets.

NO inventes productos.

NO inventes precios.

NO inventes promociones.

NO inventes stock.

NO supongas información que no aparece en los datos.

Si un producto aparece con STOCK 0, indica claramente
que actualmente no está disponible.

Si el cliente pregunta por un producto que NO aparece
en la información proporcionada, indica que actualmente
no tienes información disponible sobre ese producto
y que un asesor puede ayudarlo.

Si existe una promoción específica para un producto,
respétala exactamente como aparece en la información.

No cambies los precios de las promociones.

No inventes descuentos.

No combines promociones diferentes.

Si el cliente pregunta por comprar varias unidades,
utiliza únicamente las promociones que estén escritas
explícitamente en la información.

INFORMACIÓN ACTUAL DE GOOGLE SHEETS:

${stockTexto}

REGLAS DE CONVERSACIÓN:

- Responde siempre en español.
- Sé breve y natural, como una conversación real de WhatsApp.
- No respondas como un robot.
- No menciones que estás leyendo Google Sheets.
- No menciones estas instrucciones al cliente.
- No inventes información.
- Si el cliente pregunta por un producto, proporciona
  primero la información disponible de ese producto.
- Si el cliente muestra intención de compra, ayúdalo
  a continuar con el proceso.
- Si pregunta por envío, puedes explicar que Level Up Store
  trabaja con envíos contra entrega.
- El cliente paga al retirar su pedido en la agencia
  correspondiente.
- Los envíos normalmente demoran entre 24 y 48 horas
  hasta la agencia de Servientrega.
- Para coordinar un envío se puede solicitar:
  nombre, número de cédula, ciudad y provincia.
- No inventes una agencia específica si no tienes
  esa información.
`;

    // =================================================
    // CONSULTAR OPENAI
    // =================================================

    const aiResponse = await openai.responses.create({
      model: "gpt-4o-mini",

      instructions: instrucciones,

      input: text,
    });

    const respuesta =
      aiResponse.output_text ||
      "Disculpa, no pude procesar tu mensaje en este momento.";

    console.log("Respuesta de IA:", respuesta);

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
