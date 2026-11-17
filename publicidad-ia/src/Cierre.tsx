import React from "react";
import {
  AbsoluteFill,
  Composition,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

// Cierre de marca NOMADS COFFEE (sin IA de video).
// Fondo amarillo del costado real del empaque + granos negros + logo vectorizado desde la foto.

const W = 1080;
const H = 1920;
const FPS = 30;

// Amarillo lima del costado de la funda (muestreado de la foto y corregido por la luz de la toma).
const YELLOW = "#D5DC1F";
const YELLOW_DEEP = "#B9C014";
const INK = "#15120e";

const TRANSITION = 15; // 0,5 s de transición desde la toma anterior
const HOLD = 60; // 2 s de cierre de marca

// Grano de café negro con la ranura (en amarillo) como en el costado del empaque.
const Bean: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size * 1.3} viewBox="0 0 100 130" style={{ overflow: "visible" }}>
    <ellipse cx="50" cy="65" rx="46" ry="62" fill={INK} />
    <path
      d="M50 6 C 30 40, 70 85, 48 124"
      fill="none"
      stroke={YELLOW}
      strokeWidth="6"
      strokeLinecap="round"
    />
    {/* brillo sutil, como el acabado brillante de los granos impresos */}
    <ellipse cx="34" cy="38" rx="10" ry="18" fill="rgba(255,255,255,0.06)" transform="rotate(-20 34 38)" />
  </svg>
);

// Distribución inspirada en el costado: granos en los bordes, algunos cortados por el marco.
const BEANS = [
  { x: -60, y: 120, s: 210, r: -35, d: 1.0 },
  { x: 860, y: 40, s: 170, r: 25, d: 0.7 },
  { x: 900, y: 520, s: 230, r: 40, d: 1.2 },
  { x: -90, y: 700, s: 190, r: 70, d: 0.8 },
  { x: 40, y: 1250, s: 160, r: -15, d: 0.9 },
  { x: 880, y: 1150, s: 200, r: 10, d: 1.1 },
  { x: -70, y: 1620, s: 230, r: 30, d: 1.0 },
  { x: 820, y: 1640, s: 180, r: -40, d: 0.75 },
  { x: 420, y: 1780, s: 150, r: 80, d: 0.6 },
  { x: 480, y: -90, s: 150, r: -60, d: 0.6 },
];

const ease = Easing.bezier(0.33, 0, 0.2, 1);

/** Toma anterior de reemplazo mientras no exista el clip IA: tonos cálidos y "vapor". */
export const PlaceholderPrevio: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(ellipse 70% 50% at 40% 55%, #6b4426 0%, #2b1a0e 55%, #0b0705 100%)",
      }}
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: 260 + i * 90,
            top: 600 - f * (2 + i) - i * 120,
            width: 260,
            height: 520,
            borderRadius: "50%",
            background: "radial-gradient(ellipse, rgba(255,240,220,0.22), rgba(255,240,220,0) 70%)",
            filter: "blur(30px)",
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

/** Cierre de marca. `previo` es la toma anterior (clip IA) sobre la que se hace la transición. */
export const CierreMarca: React.FC<{ previo?: React.ReactNode }> = ({ previo }) => {
  const f = useCurrentFrame();

  // --- Transición: la toma anterior se desenfoca y se ilumina, el amarillo aparece desde el centro
  const tIn = interpolate(f, [0, TRANSITION], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const revealRadius = interpolate(tIn, [0, 1], [0, 150]); // % del radio de la máscara
  const mask = `radial-gradient(circle at 50% 46%, #000 ${revealRadius * 0.25}%, transparent ${revealRadius}%)`;

  // --- Logo: entra con opacidad, escala y desenfoque → nitidez; luego "respira"
  const logoIn = interpolate(f, [8, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const breathe = 1 + 0.012 * Math.sin(((f - 30) / FPS) * Math.PI * 0.9) * (f > 30 ? 1 : 0);
  const logoScale = (0.96 + 0.04 * logoIn) * breathe;

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {/* Toma anterior, desenfocándose y aclarándose */}
      {previo ? (
        <AbsoluteFill style={{ filter: `blur(${tIn * 22}px) brightness(${1 + tIn * 0.6})` }}>
          {previo}
        </AbsoluteFill>
      ) : null}

      {/* Plano amarillo de marca */}
      <AbsoluteFill style={{ WebkitMaskImage: mask, maskImage: mask, opacity: Math.pow(tIn, 0.6) }}>
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse 80% 60% at 50% 45%, ${YELLOW} 0%, ${YELLOW} 45%, ${YELLOW_DEEP} 100%)`,
          }}
        />

        {/* Granos con deriva lenta (profundidad) */}
        {BEANS.map((b, i) => {
          const drift = interpolate(f, [0, TRANSITION + HOLD], [0, 1]);
          const dx = Math.sin(i * 1.7) * 18 * drift * b.d;
          const dy = -14 * drift * b.d;
          const appear = interpolate(f, [4 + i * 1.2, 18 + i * 1.2], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: b.x,
                top: b.y,
                opacity: appear,
                transform: `translate(${dx}px, ${dy}px) rotate(${b.r + drift * 4 * b.d}deg) scale(${0.92 + 0.08 * appear})`,
                filter: b.d < 0.8 ? "blur(2px)" : undefined,
              }}
            >
              <Bean size={b.s} />
            </div>
          );
        })}

        {/* Logo original vectorizado desde la foto del empaque */}
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <Img
            src={staticFile("brand/logo-nomads-trazado.svg")}
            style={{
              width: 580,
              marginTop: -60,
              opacity: logoIn,
              transform: `scale(${logoScale})`,
              filter: `blur(${(1 - logoIn) * 8}px) drop-shadow(0 6px 18px rgba(80,70,0,0.25))`,
            }}
          />
        </AbsoluteFill>

        {/* Viñeta y grano fino para que el amarillo no se vea plano */}
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(ellipse 85% 70% at 50% 45%, rgba(0,0,0,0) 55%, rgba(40,30,0,0.35) 100%)",
          }}
        />
        <Img
          src={staticFile("brand/grano.png")}
          style={{
            position: "absolute",
            inset: 0,
            width: W,
            height: H,
            opacity: 0.07,
            mixBlendMode: "overlay",
            transform: `translate(${(f % 3) * 2}px, ${(f % 2) * 2}px)`,
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const CierreMarcaPreview: React.FC = () => <CierreMarca previo={<PlaceholderPrevio />} />;

export const CierreCompositions: React.FC = () => (
  <Composition
    id="CierreMarca"
    component={CierreMarcaPreview}
    durationInFrames={TRANSITION + HOLD}
    fps={FPS}
    width={W}
    height={H}
  />
);
