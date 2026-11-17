import React from "react";
import {
  AbsoluteFill,
  Composition,
  continueRender,
  delayRender,
  Easing,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

// Fuente local (public/fonts): no depende de internet al renderizar.
const oswald = "Oswald";
if (typeof document !== "undefined") {
  const handle = delayRender("Cargando Oswald");
  Promise.all(
    [300, 400, 500].map((w) =>
      new FontFace(oswald, `url(${staticFile(`fonts/oswald-latin-${w}-normal.woff2`)})`, {
        weight: String(w),
      })
        .load()
        .then((ff) => document.fonts.add(ff)),
    ),
  ).then(() => continueRender(handle));
}

// ---------------------------------------------------------------------------
// Constantes de escena
// ---------------------------------------------------------------------------
const W = 1080;
const H = 1920;
const FPS = 30;
const DURATION = 300; // 10 s

// Imagen recortada del frente (public/front.png = 831 x 1100)
const BAG_W = 720;
const BAG_H = Math.round((BAG_W * 1100) / 831);
const BAG_LEFT = (W - BAG_W) / 2;
const BAG_TOP = 470;

const YELLOW = "#dfe03a";
const XFADE = 10; // frames de fundido cruzado entre planos

const ease = Easing.bezier(0.45, 0, 0.2, 1);

type Cam = { fx: number; fy: number; s: number };

/** Interpola dos posiciones de cámara (punto de foco relativo al empaque + escala). */
const lerpCam = (t: number, a: Cam, b: Cam): Cam => ({
  fx: a.fx + (b.fx - a.fx) * t,
  fy: a.fy + (b.fy - a.fy) * t,
  s: a.s + (b.s - a.s) * t,
});

// ---------------------------------------------------------------------------
// Capas
// ---------------------------------------------------------------------------

/** Fondo cálido y elegante, con un leve acercamiento propio (parallax). */
const Backdrop: React.FC<{ zoom: number }> = ({ zoom }) => (
  <AbsoluteFill
    style={{
      transform: `scale(${zoom})`,
      background:
        "radial-gradient(ellipse 70% 45% at 50% 46%, #6b4426 0%, #3a2414 38%, #1a0f08 70%, #0a0604 100%)",
    }}
  >
    {/* Superficie / mesa */}
    <AbsoluteFill
      style={{
        top: BAG_TOP + BAG_H - 40,
        background:
          "linear-gradient(180deg, rgba(40,24,12,0.0) 0%, rgba(20,12,6,0.85) 35%, #070403 100%)",
      }}
    />
  </AbsoluteFill>
);

/** El empaque con sombra, reflejo y barrido de luz. Vive en el espacio del "set". */
const Bag: React.FC<{ src: string; sweep: number; withFloor?: boolean }> = ({
  src,
  sweep,
  withFloor = true,
}) => (
  <>
    {withFloor ? (
      <>
        {/* Sombra de contacto */}
        <div
          style={{
            position: "absolute",
            left: BAG_LEFT - 40,
            top: BAG_TOP + BAG_H - 40,
            width: BAG_W + 80,
            height: 80,
            borderRadius: "50%",
            background:
              "radial-gradient(ellipse at center, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0) 70%)",
          }}
        />
        {/* Reflejo sutil */}
        <Img
          src={src}
          style={{
            position: "absolute",
            left: BAG_LEFT,
            top: BAG_TOP + BAG_H - 6,
            width: BAG_W,
            height: BAG_H,
            transform: "scaleY(-1)",
            opacity: 0.16,
            WebkitMaskImage:
              "linear-gradient(0deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 28%)",
            maskImage:
              "linear-gradient(0deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 28%)",
          }}
        />
      </>
    ) : null}
    <Img
      src={src}
      style={{
        position: "absolute",
        left: BAG_LEFT,
        top: BAG_TOP,
        width: BAG_W,
        height: BAG_H,
      }}
    />
    {/* Barrido de luz cálida limitado a la silueta del empaque */}
    <div
      style={{
        position: "absolute",
        left: BAG_LEFT,
        top: BAG_TOP,
        width: BAG_W,
        height: BAG_H,
        mixBlendMode: "screen",
        background: `linear-gradient(105deg, rgba(255,200,140,0) ${sweep - 22}%, rgba(255,210,160,0.28) ${sweep}%, rgba(255,200,140,0) ${sweep + 22}%)`,
        WebkitMaskImage: `url(${staticFile("front.png")})`,
        WebkitMaskSize: "100% 100%",
        maskImage: `url(${staticFile("front.png")})`,
        maskSize: "100% 100%",
      }}
    />
  </>
);

/**
 * Cámara virtual: coloca el punto (fx, fy) del empaque en el centro del cuadro
 * y aplica la escala s. dof > 0 simula profundidad de campo reducida mezclando
 * una versión desenfocada (pre-calculada, barata) con una nítida enmascarada.
 */
const Shot: React.FC<{
  cam: Cam;
  dof?: number;
  sweep: number;
  centerY?: number;
}> = ({ cam, dof = 0, sweep, centerY = H / 2 }) => {
  const px = BAG_LEFT + cam.fx * BAG_W;
  const py = BAG_TOP + cam.fy * BAG_H;
  const transform = `translate(${W / 2 - px * cam.s}px, ${centerY - py * cam.s}px) scale(${cam.s})`;
  const set = (src: string) => (
    <AbsoluteFill style={{ transform, transformOrigin: "0 0" }}>
      <Bag src={src} sweep={sweep} />
    </AbsoluteFill>
  );

  if (dof <= 0) return set(staticFile("front.png"));

  const mask = `radial-gradient(ellipse ${46 - dof * 10}% ${26 - dof * 8}% at 50% 50%, #000 45%, transparent 100%)`;
  return (
    <>
      {set(staticFile("front_blur.png"))}
      <AbsoluteFill style={{ WebkitMaskImage: mask, maskImage: mask }}>
        {set(staticFile("front.png"))}
      </AbsoluteFill>
    </>
  );
};

/** Viñeta y luz cálida de ambiente, en espacio de pantalla. */
const Grade: React.FC = () => (
  <>
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(ellipse 85% 70% at 50% 45%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.5) 100%)",
      }}
    />
    <AbsoluteFill
      style={{
        mixBlendMode: "soft-light",
        background:
          "linear-gradient(160deg, rgba(255,170,90,0.35) 0%, rgba(255,170,90,0) 45%, rgba(0,0,0,0.25) 100%)",
      }}
    />
  </>
);

/** Fundido de entrada de cada plano (el anterior sigue visible debajo). */
const useFadeIn = (len = XFADE) => {
  const f = useCurrentFrame();
  return interpolate(f, [0, len], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });
};

const progress = (f: number, len: number) =>
  interpolate(f, [0, len], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });

// ---------------------------------------------------------------------------
// Planos
// ---------------------------------------------------------------------------

// 1. Plano general
const S1: React.FC<{ len: number }> = ({ len }) => {
  const f = useCurrentFrame();
  const t = progress(f, len);
  const cam = lerpCam(t, { fx: 0.5, fy: 0.56, s: 0.92 }, { fx: 0.5, fy: 0.52, s: 1.04 });
  const fromBlack = interpolate(f, [0, 18], [1, 0], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <Backdrop zoom={1 + t * 0.04} />
      <Shot cam={cam} sweep={interpolate(f, [0, len], [-20, 70])} />
      <Grade />
      <AbsoluteFill style={{ background: "#000", opacity: fromBlack }} />
    </AbsoluteFill>
  );
};

// 2. Acercamiento al logotipo con profundidad de campo reducida
const S2: React.FC<{ len: number }> = ({ len }) => {
  const f = useCurrentFrame();
  const t = progress(f, len);
  const cam = lerpCam(t, { fx: 0.53, fy: 0.37, s: 2.05 }, { fx: 0.54, fy: 0.35, s: 2.35 });
  return (
    <AbsoluteFill style={{ opacity: useFadeIn() }}>
      <Backdrop zoom={1.15} />
      <Shot cam={cam} dof={0.8} sweep={interpolate(f, [0, len], [10, 90])} />
      <Grade />
    </AbsoluteFill>
  );
};

// 3. Plano macro de la etiqueta (altitud, origen, tueste)
const S3: React.FC<{ len: number }> = ({ len }) => {
  const f = useCurrentFrame();
  const t = progress(f, len);
  const cam = lerpCam(t, { fx: 0.36, fy: 0.865, s: 2.9 }, { fx: 0.6, fy: 0.86, s: 3.05 });
  return (
    <AbsoluteFill style={{ opacity: useFadeIn() }}>
      <Backdrop zoom={1.2} />
      <Shot cam={cam} dof={1} sweep={interpolate(f, [0, len], [0, 100])} />
      <Grade />
    </AbsoluteFill>
  );
};

// 4. Movimiento lateral sobre la textura e ilustración de la montaña
const S4: React.FC<{ len: number }> = ({ len }) => {
  const f = useCurrentFrame();
  const t = progress(f, len);
  const cam = lerpCam(t, { fx: 0.24, fy: 0.6, s: 2.5 }, { fx: 0.78, fy: 0.58, s: 2.5 });
  return (
    <AbsoluteFill style={{ opacity: useFadeIn() }}>
      <Backdrop zoom={1.2} />
      <Shot cam={cam} dof={0.5} sweep={interpolate(f, [0, len], [100, 0])} />
      <Grade />
    </AbsoluteFill>
  );
};

// 5. Plano final publicitario (sólo textos que aparecen en el empaque)
const S5: React.FC<{ len: number }> = ({ len }) => {
  const f = useCurrentFrame();
  const t = progress(f, len);
  const cam = lerpCam(t, { fx: 0.5, fy: 0.5, s: 0.86 }, { fx: 0.5, fy: 0.5, s: 0.82 });
  const txt = (delay: number) => {
    const o = interpolate(f, [delay, delay + 14], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    return { opacity: o, transform: `translateY(${(1 - o) * 18}px)` };
  };
  return (
    <AbsoluteFill style={{ opacity: useFadeIn(14) }}>
      <Backdrop zoom={1} />
      <Shot cam={cam} centerY={800} sweep={interpolate(f, [0, len], [-10, 80])} />
      <Grade />
      <AbsoluteFill
        style={{
          top: 1450,
          alignItems: "center",
          fontFamily: oswald,
          color: "#f3ead8",
          textAlign: "center",
          letterSpacing: 6,
        }}
      >
        <div style={{ ...txt(6), fontSize: 30, fontWeight: 400, color: YELLOW, letterSpacing: 10 }}>
          ESPRESSO · MEDIUM ROAST
        </div>
        <div style={{ ...txt(12), width: 120, height: 2, background: YELLOW, margin: "22px 0 24px" }} />
        <div style={{ ...txt(16), fontSize: 50, fontWeight: 300 }}>
          CACAO · AVELLANA · CARAMELO
        </div>
        <div style={{ ...txt(22), fontSize: 30, fontWeight: 300, marginTop: 18, opacity: 0.85 * txt(22).opacity }}>
          LOJA – CARIAMANGA · ECUADOR
        </div>
        <div style={{ ...txt(28), fontSize: 30, fontWeight: 500, marginTop: 40, color: YELLOW, letterSpacing: 4 }}>
          @NOMADS.EC
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Montaje
// ---------------------------------------------------------------------------
const CUTS = [
  { C: S1, from: 0, len: 78 },
  { C: S2, from: 72, len: 66 },
  { C: S3, from: 132, len: 62 },
  { C: S4, from: 188, len: 64 },
  { C: S5, from: 246, len: 54 },
];

export const NomadsAd: React.FC = () => (
  <AbsoluteFill style={{ background: "#000" }}>
    {CUTS.map(({ C, from, len }) => (
      <Sequence key={from} from={from} durationInFrames={len} layout="none">
        <AbsoluteFill>
          <C len={len} />
        </AbsoluteFill>
      </Sequence>
    ))}
  </AbsoluteFill>
);

export const MyComposition = () => (
  <Composition
    id="NomadsAd"
    component={NomadsAd}
    durationInFrames={DURATION}
    fps={FPS}
    width={W}
    height={H}
  />
);
