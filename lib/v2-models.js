'use strict';
const { atStage, inStage, safeError } = require('./v2-errors');
function createModels({ client, env, log = () => {} }) {
  const metrics = { calls: 0, input_tokens: 0, output_tokens: 0, estimated_cost: null, by_model: {} };
  async function respond(args, level = 'LOW', conversation = null) {
    const model = env[`MODEL_${level}`];
    if (!model?.trim()) throw atStage(new Error(`Falta MODEL_${level}`), 'model.select');
    metrics.calls++;
    const local = conversation ? (conversation.metrics ||= { calls: 0, input_tokens: 0, output_tokens: 0, estimated_cost: null, by_model: {} }) : null;
    if (local) local.calls++;
    let result;
    try { result = await client.responses.create({ ...args, model }); }
    catch (error) { atStage(error, 'openai.responses'); log({ event: 'model_error', level, ...safeError(error) }); throw error; }
    if (!result || typeof result !== 'object') throw atStage(new TypeError('Respuesta de modelo inválida'), 'model.response');
    const input = Number(result.usage?.input_tokens) || 0, output = Number(result.usage?.output_tokens) || 0;
    const inputValue = env[`MODEL_${level}_INPUT_USD_PER_MILLION`];
    const inputRate = inputValue?.trim() ? Number(inputValue) : NaN;
    const outputValue = env[`MODEL_${level}_OUTPUT_USD_PER_MILLION`];
    const outputRate = outputValue?.trim() ? Number(outputValue) : NaN;
    const priced = Number.isFinite(inputRate) && inputRate >= 0 && Number.isFinite(outputRate) && outputRate >= 0 && result.usage;
    const cost = priced ? (input * inputRate + output * outputRate) / 1e6 : null;
    for (const target of [metrics, local].filter(Boolean)) {
      target.input_tokens += input; target.output_tokens += output;
      target.unpriced_calls = (target.unpriced_calls || 0) + (cost === null ? 1 : 0);
      target.priced_cost = (target.priced_cost || 0) + (cost || 0);
      target.estimated_cost = target.unpriced_calls ? null : target.priced_cost;
      const bucket = target.by_model[model] ||= { calls: 0, input_tokens: 0, output_tokens: 0 };
      bucket.calls++; bucket.input_tokens += input; bucket.output_tokens += output;
    }
    log({ event: 'model_call', model, level, input_tokens: input, output_tokens: output, estimated_cost: cost });
    return inStage('model.output_text', () => {
      if (result.output_text != null && typeof result.output_text !== 'string') throw new TypeError('Response output_text inválido');
      const output = Array.isArray(result.output) ? result.output : [];
      const outputText = result.output_text ?? output.filter(item => item.type === 'message').flatMap(item => Array.isArray(item.content) ? item.content : []).filter(item => item.type === 'output_text' && typeof item.text === 'string').map(item => item.text).join('');
      const status = ['completed','incomplete','failed','cancelled','queued','in_progress'].includes(result.status) ? result.status : 'unknown';
      const reason = ['max_output_tokens','content_filter'].includes(result.incomplete_details?.reason) ? result.incomplete_details.reason : null;
      log({ event: 'model_response', level, status, incomplete_reason: reason, has_text: !!outputText.trim(), reasoning_tokens: Number(result.usage?.output_tokens_details?.reasoning_tokens) || 0 });
      return { ...result, output_text: outputText };
    });
  }
  async function transcribe(args, seconds, conversation = null, requestOptions = {}) {
    const model = env.MODEL_TRANSCRIPTION;
    if (!model?.trim()) throw new Error('Falta MODEL_TRANSCRIPTION');
    const local = conversation ? (conversation.metrics ||= { calls: 0, input_tokens: 0, output_tokens: 0, estimated_cost: null, by_model: {} }) : null;
    for (const target of [metrics, local].filter(Boolean)) target.calls++;
    let result;
    try { result = await client.audio.transcriptions.create({ ...args, model }, requestOptions); }
    catch (error) { atStage(error, 'openai.transcription'); log({ event: 'transcription_error', ...safeError(error) }); throw error; }
    const input = Number(result.usage?.input_tokens) || 0, output = Number(result.usage?.output_tokens) || 0;
    const value = env.MODEL_TRANSCRIPTION_USD_PER_MINUTE;
    const rate = value?.trim() ? Number(value) : NaN;
    const cost = Number.isFinite(rate) && rate >= 0 ? seconds * rate / 60 : null;
    for (const target of [metrics, local].filter(Boolean)) {
      target.input_tokens += input; target.output_tokens += output;
      target.unpriced_calls = (target.unpriced_calls || 0) + (cost === null ? 1 : 0);
      target.priced_cost = (target.priced_cost || 0) + (cost || 0);
      target.estimated_cost = target.unpriced_calls ? null : target.priced_cost;
      const bucket = target.by_model[model] ||= { calls: 0, input_tokens: 0, output_tokens: 0 };
      bucket.calls++; bucket.input_tokens += input; bucket.output_tokens += output;
    }
    log({ event: 'transcription', model, seconds, input_tokens: input, output_tokens: output, estimated_cost: cost });
    return result;
  }
  return { respond, transcribe, metrics };
}
module.exports = { createModels };
