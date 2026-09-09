"use strict";

const OpenAI = require("openai");
const { google } = require("googleapis");

const VARIABLES_REQUERIDAS = [
  "OPENAI_API_KEY",
  "PHONE_NUMBER_ID",
  "WHATSAPP_TOKEN",
  "VERIFY_TOKEN",
  "ASESOR_WHATSAPP",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "STOCK_SPREADSHEET_ID",
  "MEMORIA_SPREADSHEET_ID",
];

function resultado(nombre, estado, detalle) {
  console.log(`[${estado}] ${nombre}: ${detalle}`);
}

function faltantes(nombres) {
  return nombres.filter((nombre) => !process.env[nombre]);
}

async function comprobarOpenAI() {
  if (faltantes(["OPENAI_API_KEY"]).length) {
    resultado("OpenAI", "ERROR", "falta OPENAI_API_KEY");
    return false;
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    await client.models.list({ limit: 1 });
    resultado("OpenAI", "OK", "autenticación correcta");
    return true;
  } catch (error) {
    resultado("OpenAI", "ERROR", `no se pudo autenticar (${error.status || error.name || "error de conexión"})`);
    return false;
  }
}

async function comprobarGoogleSheets() {
  const requeridas = [
    "GOOGLE_SERVICE_ACCOUNT_JSON",
    "STOCK_SPREADSHEET_ID",
    "MEMORIA_SPREADSHEET_ID",
  ];
  const variablesFaltantes = faltantes(requeridas);

  if (variablesFaltantes.length) {
    resultado("Google Sheets", "ERROR", `faltan ${variablesFaltantes.join(", ")}`);
    return false;
  }

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({ version: "v4", auth });

    await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId: process.env.STOCK_SPREADSHEET_ID,
        range: "'PAGINA DE STOCK'!A1",
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId: process.env.MEMORIA_SPREADSHEET_ID,
        range: "MEMORIA!A1",
      }),
    ]);

    resultado("Google Sheets", "OK", "autenticación y lectura de ambas hojas correctas");
    return true;
  } catch (error) {
    resultado("Google Sheets", "ERROR", `no se pudo autenticar o leer las hojas (${error.code || error.name || "error de conexión"})`);
    return false;
  }
}

async function comprobarMetaWhatsApp() {
  const requeridas = ["PHONE_NUMBER_ID", "WHATSAPP_TOKEN"];
  const variablesFaltantes = faltantes(requeridas);

  if (variablesFaltantes.length) {
    resultado("Meta/WhatsApp", "ERROR", `faltan ${variablesFaltantes.join(", ")}`);
    return false;
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/v23.0/${process.env.PHONE_NUMBER_ID}?fields=id`,
      {
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!response.ok) {
      resultado("Meta/WhatsApp", "ERROR", `autenticación rechazada o número no accesible (HTTP ${response.status})`);
      return false;
    }

    resultado("Meta/WhatsApp", "OK", "autenticación correcta");
    return true;
  } catch (error) {
    resultado("Meta/WhatsApp", "ERROR", `no se pudo conectar (${error.name || "error de conexión"})`);
    return false;
  }
}

async function main() {
  console.log("Diagnóstico de integraciones (no se mostrarán secretos).\n");

  const variablesFaltantes = faltantes(VARIABLES_REQUERIDAS);
  if (variablesFaltantes.length) {
    resultado("Variables de entorno", "ERROR", `faltan ${variablesFaltantes.join(", ")}`);
  } else {
    resultado("Variables de entorno", "OK", "todas las variables requeridas están presentes");
  }

  const resultados = await Promise.all([
    comprobarOpenAI(),
    comprobarGoogleSheets(),
    comprobarMetaWhatsApp(),
  ]);

  if (variablesFaltantes.length || resultados.includes(false)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  resultado("Diagnóstico", "ERROR", error.name || "error inesperado");
  process.exitCode = 1;
});
