const express = require("express");

const app = express();
app.use(express.json());

const VERIFY_TOKEN = "levelup_verificacion_2026";

const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  try {
    console.log("Mensaje recibido:", JSON.stringify(req.body));

    const message =
      req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body;

    console.log("Número:", from);
    console.log("Mensaje:", text);

    if (text) {
      const respuesta = `Hola 👋 Gracias por escribir a Level Up Store.

Recibimos tu mensaje: "${text}"

En breve te atenderemos. 🛒💻`;

      const response = await fetch(
        `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: from,
            type: "text",
            text: {
              body: respuesta
            }
          })
        }
      );

      const data = await response.json();

      console.log("Respuesta de WhatsApp:", JSON.stringify(data));
    }

    res.sendStatus(200);

  } catch (error) {
    console.error("ERROR:", error);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor funcionando en el puerto ${PORT}`);
});  console.log(`Servidor funcionando en el puerto ${PORT}`);
});
