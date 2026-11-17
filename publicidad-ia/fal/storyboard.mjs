// Storyboard "De la tierra a tu taza" → trabajos de generación.
// Cada escena: un fotograma clave (FLUX.2 Pro) + un clip imagen→video.
// "startFrom" indica que el fotograma inicial es el último cuadro de otra escena (continuidad).

const LOOK =
  "vertical 9:16, cinematic premium coffee commercial, hyperreal, shot on ARRI Alexa with macro lens, warm golden natural light, charcoal black, coffee brown, warm gold and natural beige palette, soft shadows, shallow depth of field, fine film grain, no text";

export const SCENES = [
  {
    n: 1, name: "El origen", slot: [0, 4], model: "kling", duration: 5,
    keyframe: `Ecuadorian coffee farmer in his 50s with straw hat and plaid shirt picking ripe red coffee cherries on a steep Andean farm in Loja at sunrise, golden backlight through leaves, misty green mountains, ${LOOK}`,
    motion: "Slow lateral dolly along the coffee branch toward the farmer's hands, then smooth push-in to an extreme macro of a single glossy red coffee cherry with dew drops as his fingers pick it. Natural hand motion, leaves swaying gently, sun flare. Steady, continuous, no cuts.",
  },
  {
    n: 2, name: "Transformación", slot: [4, 7], model: "kling", duration: 5,
    keyframe: `Macro shot of ripe red coffee cherries tumbling into a weathered green metal coffee pulping machine on a rural Ecuadorian farm, water splashing, wet pulp and pale coffee beans separating, ${LOOK}`,
    motion: "Slow lateral macro tracking shot following the cherries as they enter the pulper; water droplets and pulp fly in slow motion; pale wet coffee beans slide out. Realistic mechanical motion, physically accurate water.",
  },
  {
    n: 3, name: "Secado", slot: [7, 10], model: "kling", duration: 5,
    keyframe: `Top-down view of raised drying beds full of beige parchment coffee beans, a weathered farmer hand entering the frame, Andean mountains softly blurred, ${LOOK}`,
    motion: "Overhead camera slowly descends while the hand rakes through the beans with natural fingers, beans rolling and settling, dust particles in sunlight. Ends on a close macro of the bean texture.",
  },
  {
    n: 4, name: "El tostado", slot: [10, 14], model: "kling", duration: 5,
    keyframe: `Extreme macro inside a stainless steel drum coffee roaster, glossy dark brown roasted coffee beans tumbling, metallic stirring arm, amber rim light, wisps of smoke, reflections on the oily bean surface, ${LOOK}`,
    motion: "Slow orbiting macro shot as the drum rotates and the stirring arm sweeps the beans; beans tumble naturally, smoke curls upward, amber rim light. Smooth and continuous.",
  },
  {
    n: 5, name: "La molienda", slot: [14, 18], model: "kling", duration: 5,
    keyframe: `Macro shot of roasted coffee beans falling into the hopper of a steel burr coffee grinder, warm amber key light, dark background, ${LOOK}`,
    endKeyframe: `Almost completely black frame with a few fine coffee ground particles faintly lit by warm light, ${LOOK}`,
    motion: "Camera follows the falling beans down into the grinder, passing between the steel burrs; beans crack and fragment progressively into fine coffee grounds; light fades to complete darkness. Immersive POV, one continuous take.",
  },
  {
    n: 6, name: "La revelación", slot: [18, 21], model: "kling", duration: 5, startFrom: 5,
    motion: "From darkness, fine coffee grounds drift and catch warm light; the camera pulls back smoothly to reveal we are inside a matte black coffee pouch; hands at the top open the zip and warm daylight pours in over a mound of fresh ground coffee. The pouch has no text. One continuous take.",
  },
  {
    n: 7, name: "El ritual", slot: [21, 25], model: "veo", duration: 6,
    keyframe: `Glass pour-over dripper with white paper filter on a glass carafe, freshly ground coffee inside, gooseneck kettle spout above, warm side light, wooden table, dark warm background, steam, macro, ${LOOK}`,
    motion: "Hot water pours in a thin spiral from the gooseneck kettle; the coffee bed blooms and bubbles; slow macro push-in; amber coffee drips into the carafe; natural steam rising. Physically accurate liquid.",
  },
  {
    n: "8a", name: "La experiencia (sorbo)", slot: [25, 26.5], model: "veo", duration: 4,
    keyframe: `Close-up of a young Latino man in warm morning light about to take a slow sip of black coffee from a clear glass cup, eyes closed, subtle smile, steam, hyperreal skin texture, ${LOOK}`,
    motion: "Subtle slow push-in while he takes one natural slow sip, steam drifting, warm light.",
  },
  {
    n: "8b", name: "La experiencia (mesa)", slot: [26.5, 28], model: "kling", duration: 5,
    keyframe: `Steaming clear glass cup of black coffee on a warm wooden table, generous empty space on the right side for a product, warm window light, dark warm background, ${LOOK}`,
    motion: "Very slow push-in, steam rising naturally from the cup, gentle light flicker from the window. Camera stays steady.",
    note: "El empaque real (foto recortada) se compone en Remotion en el espacio vacío.",
  },
  {
    n: 9, name: "Cierre de marca", slot: [28, 30], model: null,
    note: "Se hace en Remotion con el logo SVG reconstruido: sin IA y sin costo.",
  },
];

/** Prueba inicial propuesta: escena 4 (sin personas, prueba realismo macro). */
export const FIRST_TEST = { scene: 4 };
