// Registro de modelos de fal.ai usados en el comercial.
// Los IDs se verificaron contra el catálogo de fal.ai (api.fal.ai/v1/models) el 2026-11-17.
// El precio NO se fija aquí: se consulta en vivo con la API de precios de fal.ai.

export const MODELS = {
  // Fotogramas clave (imagen inicial de cada clip)
  keyframe: {
    id: "fal-ai/flux-2-pro",
    kind: "image",
    label: "FLUX.2 Pro (fotograma clave)",
    size: { width: 864, height: 1536 }, // 9:16, 1,33 MP
  },
  // Kling: modelo principal para la mayoría de escenas
  kling: {
    id: "fal-ai/kling-video/v3/standard/image-to-video",
    kind: "video",
    label: "Kling 3.0 Standard (imagen → video)",
    imageField: "start_image_url",
    endImageField: "end_image_url",
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    extra: { generate_audio: false }, // el sonido se diseña aparte
  },
  // Kling económico, para tomas de prueba
  klingEco: {
    id: "fal-ai/kling-video/v2.5-turbo/standard/image-to-video",
    kind: "video",
    label: "Kling 2.5 Turbo Standard (económico)",
    imageField: "image_url",
    durations: [5, 10],
  },
  // Veo: fal.ai lo marca como "deprecated"; puede dejar de estar disponible.
  veo: {
    id: "fal-ai/veo3/fast/image-to-video",
    kind: "video",
    label: "Veo 3 Fast (imagen → video) [deprecated en fal.ai]",
    deprecated: true,
    imageField: "image_url",
    durations: [4, 6, 8],
    formatDuration: (d) => `${d}s`,
    extra: { aspect_ratio: "9:16", resolution: "1080p", generate_audio: false },
  },
  // Sucesor activo de Google en fal.ai (alternativa a Veo)
  googleOmni: {
    id: "google/gemini-omni-flash/v1.2/image-to-video",
    kind: "video",
    label: "Gemini Omni Flash 1.2 (Google, imagen → video)",
    imageField: "image_url",
    endImageField: "end_image_url",
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    formatDuration: (d) => d,
    extra: { aspect_ratio: "9:16", resolution: "1080p" },
  },
};

export const NEGATIVE =
  "text, letters, watermark, logo, cartoon, CGI look, plastic texture, warping, morphing, extra fingers, deformed hands, flicker, jitter, sudden camera moves, oversaturated, low detail";

/** Cantidad facturable (unidades de fal.ai) para un trabajo. */
export function billableUnits(model, job) {
  if (model.kind === "image") {
    // fal factura por megapíxel procesado; redondeamos hacia arriba (estimación conservadora)
    return Math.ceil((model.size.width * model.size.height) / 1e6);
  }
  return job.duration; // segundos de video
}

/** Construye el input exacto que se enviará a fal.ai. */
export function buildInput(model, job) {
  if (model.kind === "image") {
    return {
      prompt: job.prompt,
      image_size: model.size,
      output_format: "jpeg",
      enable_safety_checker: true,
    };
  }
  if (!model.durations.includes(job.duration)) {
    throw new Error(`${model.id} no admite ${job.duration}s (admite: ${model.durations.join(", ")})`);
  }
  const input = {
    prompt: job.prompt,
    [model.imageField]: job.image,
    duration: model.formatDuration ? model.formatDuration(job.duration) : String(job.duration),
    ...(model.extra ?? {}),
  };
  if (job.endImage) {
    if (!model.endImageField) throw new Error(`${model.id} no admite fotograma final`);
    input[model.endImageField] = job.endImage;
  }
  if (model.id.includes("kling") || model.id.includes("veo")) input.negative_prompt = job.negative ?? NEGATIVE;
  return input;
}
