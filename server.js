const express = require("express");

const app = express();
app.use(express.json());

const VERIFY_TOKEN = "levelup_verificacion_2026";

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

app.post("/webhook", (req, res) => {
  const message =
    req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  if (message) {
    const texto = message.text?.body;
    const numero = message.from;

    console.log("📱 Número:", numero);
    console.log("💬 Mensaje:", texto);
  }

  res.sendStatus(200);
});
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor funcionando en el puerto ${PORT}`);
});
