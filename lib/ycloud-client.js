'use strict';

async function enviarMensajeYCloud(destinatario, mensaje, { canSend, testMode = false } = {}) {
  if (!canSend || !(await canSend(destinatario))) return false;
  if (testMode) return { simulated: true };
  const apiKey = process.env.YCLOUD_API_KEY;
  const from = process.env.YCLOUD_PHONE_NUMBER;

  if (!apiKey || !from) {
    throw new Error('YCloud no configurado');
  }

  const response = await fetch('https://api.ycloud.com/v2/whatsapp/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({
      from,
      to: destinatario,
      type: 'text',
      text: {
        body: mensaje,
      },
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(`YCloud HTTP ${response.status}`);
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

module.exports = { enviarMensajeYCloud };
