import { useId } from "react";

/* 부동산 맵 평당가 순위 왕관 — the three complexes with the highest price per 평 in the region in view
 * wear a gold, silver or bronze crown in the top-right corner of their tile. One drawing serves both the
 * page (SVG, with a pulsing glow, a light sweep and a twinkle in desk2/maps.css) and
 * the PNG export (drawCrown below, the same paths on a canvas). */

export type CrownRank = 1 | 2 | 3;

/** The crown's box, in the paths' own units. */
export const CROWN_VIEW_W = 26;
export const CROWN_VIEW_H = 28;
export const crownWidth = (size: number) => (size * CROWN_VIEW_W) / CROWN_VIEW_H;

interface Metal {
  label: string;
  /** Body, top to bottom: highlight, face, shadow. */
  body: [string, string, string];
  band: [string, string, string];
  edge: string;
  glow: string;
  /** The centre gem and the two side gems. */
  gem: [string, string];
  side: [string, string];
}

const METALS: Record<CrownRank, Metal> = {
  1: {
    label: "금관",
    body: ["#fff6c2", "#f7c948", "#a86b06"],
    band: ["#ffe58a", "#e0a82a", "#8a5500"],
    edge: "#6b4200",
    glow: "#ffd54a",
    gem: ["#ff8a9a", "#c8102e"],
    side: ["#8fd3ff", "#1565c0"],
  },
  2: {
    label: "은관",
    body: ["#ffffff", "#d5dce4", "#7c8894"],
    band: ["#f4f7fa", "#b4bec9", "#5f6b77"],
    edge: "#46505b",
    glow: "#e8f1ff",
    gem: ["#b3e5ff", "#1e7fd0"],
    side: ["#e2c6ff", "#7b3fbf"],
  },
  3: {
    label: "동관",
    body: ["#ffd8b0", "#d0843f", "#7a3e12"],
    band: ["#f2b27a", "#b8662a", "#5e2c08"],
    edge: "#4a2206",
    glow: "#ff9d4d",
    gem: ["#a8f0c4", "#15803d"],
    side: ["#ffe08a", "#b7791f"],
  },
};

export const crownLabel = (rank: CrownRank) => `평당가 ${rank}위 ${METALS[rank].label}`;

// Five points: two outer, two inner valleys and the tall centre spire.
const BODY = "M3.6 21.2 L2.1 9.4 L7.6 14.6 L13 5.4 L18.4 14.6 L23.9 9.4 L22.4 21.2 Z";
// Light falling on the left facets of the crown.
const SHEEN = "M4.5 20 L3.6 12 L7.8 16 L13 7.8 L13 20 Z";
// A thin inner rim just above the band.
const RIM = "M4.2 19.2 L21.8 19.2";
const BAND = { x: 2.9, y: 20.3, w: 20.2, h: 5, r: 1.3 };
const ORBS: [number, number, number][] = [
  [2.1, 9.4, 1.7],
  [13, 5.4, 2.2],
  [23.9, 9.4, 1.7],
];
// The four-point sparkle in the upper right.
const SPARKLE = "M21 1 L21.8 3.6 L24.4 4.5 L21.8 5.4 L21 8 L20.2 5.4 L17.6 4.5 L20.2 3.6 Z";
// The centre gem as a cut diamond, the side gems as small cabochons.
const GEM = "M13 20.9 L15 22.8 L13 24.7 L11 22.8 Z";
// Side gem centres on the band.
const SIDE_X = [7.4, 18.6];

export default function RankCrown({ rank, size, className }: { rank: CrownRank; size: number; className?: string }) {
  const uid = useId().replace(/:/g, "");
  const m = METALS[rank];
  const id = (name: string) => `crown-${uid}-${name}`;
  const url = (name: string) => `url(#${id(name)})`;
  return (
    <svg
      className={`re-crown re-crown--${rank}${className ? ` ${className}` : ""}`}
      width={crownWidth(size)}
      height={size}
      viewBox={`0 0 ${CROWN_VIEW_W} ${CROWN_VIEW_H}`}
      role="img"
      aria-label={crownLabel(rank)}
      style={{ ["--crown-glow" as string]: m.glow }}
    >
      <title>{crownLabel(rank)}</title>
      <defs>
        <linearGradient id={id("body")} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor={m.body[0]} />
          <stop offset="0.45" stopColor={m.body[1]} />
          <stop offset="1" stopColor={m.body[2]} />
        </linearGradient>
        <linearGradient id={id("band")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={m.band[0]} />
          <stop offset="0.5" stopColor={m.band[1]} />
          <stop offset="1" stopColor={m.band[2]} />
        </linearGradient>
        <radialGradient id={id("orb")} cx="0.35" cy="0.3" r="0.75">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.35" stopColor={m.body[0]} />
          <stop offset="1" stopColor={m.body[2]} />
        </radialGradient>
        <radialGradient id={id("gem")} cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor={m.gem[0]} />
          <stop offset="1" stopColor={m.gem[1]} />
        </radialGradient>
        <radialGradient id={id("side")} cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor={m.side[0]} />
          <stop offset="1" stopColor={m.side[1]} />
        </radialGradient>
        <linearGradient id={id("sweep")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={id("clip")}>
          <path d={BODY} />
          <rect x={BAND.x} y={BAND.y} width={BAND.w} height={BAND.h} rx={BAND.r} />
        </clipPath>
      </defs>

      <path d={BODY} fill={url("body")} stroke={m.edge} strokeWidth="0.9" strokeLinejoin="round" />
      <path d={SHEEN} fill="#fff" opacity="0.28" />
      <path d={RIM} stroke={m.edge} strokeWidth="0.6" opacity="0.55" />
      {ORBS.map(([cx, cy, r], i) => (
        <circle key={i} cx={cx} cy={cy} r={r} fill={url("orb")} stroke={m.edge} strokeWidth="0.6" />
      ))}
      <rect x={BAND.x} y={BAND.y} width={BAND.w} height={BAND.h} rx={BAND.r} fill={url("band")} stroke={m.edge} strokeWidth="0.8" />
      <rect x={BAND.x + 1} y={BAND.y + 0.7} width={BAND.w - 2} height="0.9" rx="0.45" fill="#fff" opacity="0.45" />
      <path d={GEM} fill={url("gem")} stroke={m.edge} strokeWidth="0.5" />
      <path d="M13 21.4 L14.1 22.8 L13 22.8 Z" fill="#fff" opacity="0.7" />
      {SIDE_X.map((cx) => (
        <g key={cx}>
          <ellipse cx={cx} cy="22.8" rx="1.4" ry="1.3" fill={url("side")} stroke={m.edge} strokeWidth="0.45" />
          <circle cx={cx - 0.45} cy="22.3" r="0.4" fill="#fff" opacity="0.8" />
        </g>
      ))}

      <g clipPath={url("clip")}>
        <rect className="re-crown-sweep" x="-12" y="-4" width="8" height="36" fill={url("sweep")} transform="skewX(-20)" />
      </g>
      <path className="re-crown-sparkle" d={SPARKLE} fill="#fff" />
    </svg>
  );
}

/** The same crown on a canvas, for the map's PNG export: the glow as a shadow, the
 * rest drawn from the paths above without the animation. */
export function drawCrown(ctx: CanvasRenderingContext2D, rank: CrownRank, x: number, y: number, size: number) {
  const m = METALS[rank];
  const s = size / CROWN_VIEW_H;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);

  const body = new Path2D(BODY);
  const { x: bx, y: by, w: bw, h: bh, r: br } = BAND;
  const band = new Path2D(
    `M${bx + br} ${by} H${bx + bw - br} Q${bx + bw} ${by} ${bx + bw} ${by + br} V${by + bh - br} ` +
      `Q${bx + bw} ${by + bh} ${bx + bw - br} ${by + bh} H${bx + br} Q${bx} ${by + bh} ${bx} ${by + bh - br} ` +
      `V${by + br} Q${bx} ${by} ${bx + br} ${by} Z`
  );

  const vertical = (stops: [string, string, string], y0: number, y1: number) => {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, stops[0]);
    g.addColorStop(0.5, stops[1]);
    g.addColorStop(1, stops[2]);
    return g;
  };
  const radial = (cx: number, cy: number, r: number, inner: string, outer: string, mid?: string) => {
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.4, 0, cx, cy, r * 1.2);
    g.addColorStop(0, inner);
    if (mid) g.addColorStop(0.35, mid);
    g.addColorStop(1, outer);
    return g;
  };

  // Glow first, as a blurred shadow under the body and band.
  ctx.shadowColor = m.glow;
  ctx.shadowBlur = 5 / s;
  ctx.fillStyle = vertical(m.body, 5, 21);
  ctx.fill(body);
  ctx.fillStyle = vertical(m.band, BAND.y, BAND.y + BAND.h);
  ctx.fill(band);
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";

  ctx.lineJoin = "round";
  ctx.strokeStyle = m.edge;
  ctx.lineWidth = 0.9;
  ctx.stroke(body);
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = "#fff";
  ctx.fill(new Path2D(SHEEN));
  ctx.globalAlpha = 1;

  for (const [cx, cy, r] of ORBS) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = radial(cx, cy, r, "#fff", m.body[2], m.body[0]);
    ctx.fill();
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }

  ctx.fillStyle = vertical(m.band, BAND.y, BAND.y + BAND.h);
  ctx.fill(band);
  ctx.lineWidth = 0.8;
  ctx.stroke(band);
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = "#fff";
  ctx.fillRect(BAND.x + 1, BAND.y + 0.7, BAND.w - 2, 0.9);
  ctx.globalAlpha = 1;

  const gem = new Path2D(GEM);
  ctx.fillStyle = radial(13, 22.8, 2, m.gem[0], m.gem[1]);
  ctx.fill(gem);
  ctx.lineWidth = 0.5;
  ctx.stroke(gem);
  for (const cx of SIDE_X) {
    ctx.beginPath();
    ctx.ellipse(cx, 22.8, 1.4, 1.3, 0, 0, Math.PI * 2);
    ctx.fillStyle = radial(cx, 22.8, 1.4, m.side[0], m.side[1]);
    ctx.fill();
    ctx.lineWidth = 0.45;
    ctx.stroke();
  }

  ctx.shadowColor = "#fff";
  ctx.shadowBlur = 3 / s;
  ctx.fillStyle = "#fff";
  ctx.fill(new Path2D(SPARKLE));
  ctx.restore();
}
