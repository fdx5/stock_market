import { useId } from "react";

/* 선물 종목 아이콘 — 27개 상품 계약의 인라인 SVG 글리프.
 *
 * Inline rather than fetched, and drawn rather than sourced, for three reasons that all
 * point the same way. A board that repaints every ten seconds must not depend on
 * twenty-seven image requests to a host this app does not own; commodity icon sets on
 * the web are almost uniformly licensed, and the ones that are not are photographs that
 * turn to mud at this size; and an SVG whose outline is `currentColor` sits correctly in
 * both themes without a second asset.
 *
 * What makes them read as objects rather than as pictograms is that nothing here is a
 * flat fill. Every body carries a three-stop gradient lit from the upper left, a
 * specular highlight where that light would actually land, and a darker underside — the
 * same three pieces a rendered object has, at the smallest scale they survive. The
 * metals go one further: an ingot is defined by how it throws light back, so gold,
 * silver, platinum and palladium get a sweeping sheen across the face and stars that
 * twinkle at the corners on their own staggered cycles. Copper and aluminium get the
 * sheen without the stars — they are metals, not precious ones, and giving all six the
 * same sparkle would have flattened exactly the distinction the colour is making.
 *
 * The animation is CSS rather than SMIL so that `prefers-reduced-motion` can switch it
 * off (see styles.css); under that setting the stars stay lit at a fixed opacity instead
 * of vanishing, so the icon keeps its shape.
 *
 * Gradient ids are namespaced with `useId`, because two of these panels on one page
 * would otherwise define the same id twice and the second board would silently borrow
 * the first's fills.
 */

/** Every commodity's three-tone palette: the lit face, the body, and the shadow side.
 * Chosen to survive both themes — nothing brighter than #fff4d0, nothing so dark it
 * disappears into a night background. */
const PALETTE: Record<string, { light: string; mid: string; dark: string }> = {
  gold: { light: "#fff0b8", mid: "#e0a92c", dark: "#8f6414" },
  silver: { light: "#f4f8fc", mid: "#b9c4cf", dark: "#71808f" },
  platinum: { light: "#eaf3fa", mid: "#a8bccd", dark: "#63798b" },
  palladium: { light: "#e4edf5", mid: "#93a8bd", dark: "#566b80" },
  copper: { light: "#f3b98e", mid: "#c9764a", dark: "#7d4322" },
  aluminum: { light: "#eef2f6", mid: "#aab6c1", dark: "#6d7883" },
  crude: { light: "#8b9aa9", mid: "#4d5a68", dark: "#252e38" },
  brent: { light: "#a08f7d", mid: "#6b5b4b", dark: "#382c22" },
  gas: { light: "#bfe8ff", mid: "#3f9fdc", dark: "#1c5f8f" },
  "heating-oil": { light: "#f0a866", mid: "#c2703c", dark: "#7a411c" },
  gasoline: { light: "#f7d68a", mid: "#d9a441", dark: "#8d6417" },
  wheat: { light: "#f5dc9c", mid: "#d9b45c", dark: "#8e6f26" },
  corn: { light: "#f8e08a", mid: "#e0bc42", dark: "#8f7314" },
  soybean: { light: "#d6e39a", mid: "#a3b657", dark: "#5f6e26" },
  "soybean-oil": { light: "#f2e59a", mid: "#d4bf4f", dark: "#8a7a1c" },
  "soybean-meal": { light: "#dcc99a", mid: "#ae9760", dark: "#6c5a2f" },
  rice: { light: "#f4efdf", mid: "#cfc3a4", dark: "#8d8265" },
  oats: { light: "#eeddba", mid: "#c7b183", dark: "#816d45" },
  cotton: { light: "#ffffff", mid: "#dfe5ec", dark: "#a3adb8" },
  cocoa: { light: "#c68a5c", mid: "#8a5a3b", dark: "#4c2e1a" },
  coffee: { light: "#b07f63", mid: "#7a5240", dark: "#42281c" },
  sugar: { light: "#ffffff", mid: "#e2e8ee", dark: "#a9b3bd" },
  "orange-juice": { light: "#ffc46b", mid: "#e8862a", dark: "#a1500a" },
  cattle: { light: "#d2a06a", mid: "#a9743f", dark: "#66401b" },
  "feeder-cattle": { light: "#e3b483", mid: "#c08a52", dark: "#7a5228" },
  hog: { light: "#f6cbd0", mid: "#dda0a8", dark: "#9b6670" },
  lumber: { light: "#dfae7c", mid: "#b8895a", dark: "#71512e" },
};

const FALLBACK = { light: "#c3d2e2", mid: "#8fa3bf", dark: "#556879" };

/** The shared outline, in the row's own colour so the icon dims and theme-flips with
 * the text beside it rather than against it. */
const EDGE = { stroke: "currentColor", strokeOpacity: 0.32, strokeWidth: 0.9, fill: "none" } as const;

/** A four-point star. Drawn with quadratic curves rather than straight edges so the
 * points taper the way a glint does instead of reading as a plus sign. */
function Spark({ x, y, r, delay, tone }: { x: number; y: number; r: number; delay: number; tone: string }) {
  const d = `M0 ${-r} Q${r * 0.18} ${-r * 0.18} ${r} 0 Q${r * 0.18} ${r * 0.18} 0 ${r} Q${-r * 0.18} ${r * 0.18} ${-r} 0 Q${-r * 0.18} ${-r * 0.18} 0 ${-r} Z`;
  return (
    <path
      className="ci-spark"
      d={d}
      fill={tone}
      transform={`translate(${x} ${y})`}
      style={{ animationDelay: `${delay}s` }}
    />
  );
}

export default function CommodityIcon({ icon, size = 20 }: { icon: string; size?: number }) {
  const uid = useId().replace(/:/g, "");
  const p = PALETTE[icon] ?? FALLBACK;
  const g = (name: string) => `${uid}-${name}`;
  const url = (name: string) => `url(#${g(name)})`;

  /** The body gradient every glyph shares: lit from the upper left, body through the
   * middle, shadow at the lower right. */
  const body = (
    <linearGradient id={g("body")} x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0%" stopColor={p.light} />
      <stop offset="45%" stopColor={p.mid} />
      <stop offset="100%" stopColor={p.dark} />
    </linearGradient>
  );

  /** A flatter version for a second surface (an ingot's top face, a cube's lid) that
   * catches more light than the body does. */
  const face = (
    <linearGradient id={g("face")} x1="0" y1="0" x2="1" y2="0.6">
      <stop offset="0%" stopColor="#fff" stopOpacity={0.85} />
      <stop offset="40%" stopColor={p.light} />
      <stop offset="100%" stopColor={p.mid} />
    </linearGradient>
  );

  /** The moving highlight on a metal face. */
  const sheen = (
    <linearGradient id={g("sheen")} x1="0" y1="0" x2="1" y2="0.35">
      <stop offset="0%" stopColor="#fff" stopOpacity={0} />
      <stop offset="45%" stopColor="#fff" stopOpacity={0.9} />
      <stop offset="100%" stopColor="#fff" stopOpacity={0} />
    </linearGradient>
  );

  /** A soft round highlight, for anything with a curved body. */
  const gloss = (
    <radialGradient id={g("gloss")} cx="0.34" cy="0.28" r="0.55">
      <stop offset="0%" stopColor="#fff" stopOpacity={0.75} />
      <stop offset="100%" stopColor="#fff" stopOpacity={0} />
    </radialGradient>
  );

  const precious = icon === "gold" || icon === "silver" || icon === "platinum" || icon === "palladium";
  const metal = precious || icon === "copper" || icon === "aluminum";

  function glyph() {
    switch (icon) {
      case "gold":
      case "silver":
      case "platinum":
      case "palladium":
      case "copper":
      case "aluminum":
        return (
          <>
            {/* 앞면 · 윗면 · 옆면 세 장으로 만든 잉곳. 윗면이 가장 밝고, 앞면이 몸통,
                오른쪽 좁은 면이 그림자 쪽이다. */}
            <path d="M4.6 9.8h14.8l-2 8.4H6.6z" fill={url("body")} />
            <path d="M15.2 9.8h4.2l-2 8.4h-3z" fill={p.dark} fillOpacity={0.45} />
            <path d="M7 6.2h10l2.4 3.6H4.6z" fill={url("face")} />
            <path d="M4.6 9.8h14.8l-2 8.4H6.6z" {...EDGE} />
            <path d="M7 6.2h10l2.4 3.6H4.6z" {...EDGE} />
            {/* 면을 가로지르는 빛. 잉곳을 잉곳으로 보이게 하는 건 결국 이 한 줄이다. */}
            <path className="ci-sheen" d="M8.4 10.4h3.4l-3 7.2H5.4z" fill={url("sheen")} />
            {precious && (
              <>
                <Spark x={18.4} y={5.6} r={2.6} delay={0} tone={p.light} />
                <Spark x={5.4} y={12.6} r={1.7} delay={0.9} tone="#fff" />
                <Spark x={15.2} y={15.8} r={1.9} delay={1.7} tone={p.light} />
              </>
            )}
          </>
        );

      case "crude":
      case "brent":
        return (
          <>
            {/* 통널이 배가 부른 드럼. 위아래 타원이 있어야 원통으로 읽힌다. */}
            <path d="M6.4 6.4c3.7-.9 7.5-.9 11.2 0v11.2c-3.7.9-7.5.9-11.2 0z" fill={url("body")} />
            <ellipse cx={12} cy={6.4} rx={5.6} ry={1.7} fill={p.light} />
            <ellipse cx={12} cy={6.4} rx={5.6} ry={1.7} {...EDGE} />
            <ellipse cx={12} cy={6.4} rx={3.4} ry={0.9} fill={p.dark} fillOpacity={0.55} />
            <path d="M6.4 6.4c3.7-.9 7.5-.9 11.2 0v11.2c-3.7.9-7.5.9-11.2 0z" {...EDGE} />
            {/* 두 개의 후프. 통 자체보다 이게 드럼통이라는 신호를 더 많이 준다. */}
            <path d="M6.5 10.2c3.7-.8 7.4-.8 11 0M6.5 14.2c3.7-.8 7.4-.8 11 0" stroke={p.light} strokeOpacity={0.75} strokeWidth={1.1} fill="none" />
            <path d="M8.3 7.4c-.5 3.4-.5 6.8 0 10.2" stroke="#fff" strokeOpacity={0.3} strokeWidth={1.4} strokeLinecap="round" fill="none" />
          </>
        );

      case "gas": {
        // 물방울과 불꽃을 가르는 건 끝이 아니라 옆선이다 — 방울은 매끈하게 내려오고
        // 불꽃은 한 번 잘록해졌다가 다시 벌어진다. 그 잘록함과 끝이 옆으로 휘어
        // 나가는 혀가 없으면 파랗게 칠해도 물방울로 읽힌다(실제로 그랬다).
        const flame =
          "M12.4 1.8c.2 2.6-1.1 3.9-2.4 5.4-1.6 1.8-2.1 3-1.5 4.4-1-.3-1.6-1-1.9-2.1C5.4 11.4 4.9 13.2 4.9 15a7.1 7.1 0 0 0 14.2 0c0-2.6-1-4.7-2.4-6.5-.5 1.2-1.2 1.9-2.1 2.2.9-1.9.7-4-.6-6.1-.4-.7-1-1.3-1.6-2.8z";
        return (
          <>
            <path d={flame} fill={url("body")} />
            <path d={flame} {...EDGE} />
            {/* 속불꽃. 파란 불은 안쪽이 더 밝고, 그 대비가 불꽃임을 확정한다. */}
            <path d="M12 10.6c1.9 2.2 2.9 4 2.9 5.4a2.9 2.9 0 0 1-5.8 0c0-1.4 1-3.2 2.9-5.4z" fill={p.light} />
            <path d="M12 13.4c.9 1.1 1.3 1.9 1.3 2.6a1.3 1.3 0 0 1-2.6 0c0-.7.4-1.5 1.3-2.6z" fill="#fff" fillOpacity={0.92} />
          </>
        );
      }

      case "heating-oil":
        return (
          <>
            {/* 이 보드에서 물방울을 쓰는 건 난방유 하나뿐이다. 가솔린도 대두유도 한때
                같은 방울이었는데, 세 줄이 나란히 노란 방울이라 서로 구별되지 않았다. */}
            <path d="M12 3.2c3.6 4.5 5.5 7.4 5.5 9.9A5.5 5.5 0 0 1 12 18.6a5.5 5.5 0 0 1-5.5-5.5c0-2.5 1.9-5.4 5.5-9.9z" fill={url("body")} />
            <path d="M12 3.2c3.6 4.5 5.5 7.4 5.5 9.9A5.5 5.5 0 0 1 12 18.6a5.5 5.5 0 0 1-5.5-5.5c0-2.5 1.9-5.4 5.5-9.9z" fill={url("gloss")} />
            <path d="M12 3.2c3.6 4.5 5.5 7.4 5.5 9.9A5.5 5.5 0 0 1 12 18.6a5.5 5.5 0 0 1-5.5-5.5c0-2.5 1.9-5.4 5.5-9.9z" {...EDGE} />
            <ellipse cx={9.7} cy={12.4} rx={1.2} ry={1.9} fill="#fff" fillOpacity={0.5} transform="rotate(-18 9.7 12.4)" />
            <path d="M7.4 20.4c1 1.5 2.5 2.2 4.6 2.2s3.6-.7 4.6-2.2z" fill={p.dark} fillOpacity={0.5} />
          </>
        );

      case "gasoline":
        return (
          <>
            {/* 주유기. 방울이 아니라 기계라서, 세 개의 기름류 가운데 유일하게 실루엣만
                으로 무엇인지 말한다. */}
            <path d="M4.6 7.2c0-1.5 1-2.4 2.6-2.4h4.6c1.6 0 2.6.9 2.6 2.4v13.4H4.6z" fill={url("body")} />
            <path d="M4.6 7.2c0-1.5 1-2.4 2.6-2.4h4.6c1.6 0 2.6.9 2.6 2.4v13.4H4.6z" {...EDGE} />
            <rect x={6.4} y={7.4} width={6.2} height={4.4} rx={0.9} fill="#fff" fillOpacity={0.72} />
            <rect x={6.4} y={7.4} width={6.2} height={4.4} rx={0.9} {...EDGE} />
            <path d="M6.6 14.4h5.8" stroke={p.dark} strokeOpacity={0.5} strokeWidth={1.2} strokeLinecap="round" fill="none" />
            {/* 호스와 노즐 */}
            <path d="M14.4 9.6h2.6c1.4 0 2.2.9 2.2 2.2v4.4a1.5 1.5 0 0 1-3 0v-3.4" {...EDGE} strokeWidth={1.5} strokeLinecap="round" />
            <rect x={13.6} y={8.2} width={2.6} height={2.8} rx={0.8} fill={p.dark} fillOpacity={0.75} />
            <path d="M3.4 20.6h13.2" stroke="currentColor" strokeOpacity={0.4} strokeWidth={1.4} strokeLinecap="round" fill="none" />
          </>
        );

      case "wheat":
      case "oats": {
        // 밀은 촘촘한 이삭에 까끄라기가 서고, 귀리는 성글게 늘어진다. 같은 부품으로
        // 두 곡물을 가르는 건 결국 낟알이 붙는 각도와 간격이다.
        const lean = icon === "wheat" ? 1.5 : 3.2;
        const step = icon === "wheat" ? 2.6 : 3.1;
        const rows = [0, 1, 2, 3];
        return (
          <>
            <path d="M12 21.6V8.6" stroke={p.dark} strokeWidth={1.2} strokeLinecap="round" fill="none" />
            {rows.map((i) => {
              const y = 6.6 + i * step;
              const tilt = icon === "wheat" ? 30 : 46;
              return (
                <g key={i}>
                  <ellipse cx={12 - lean} cy={y} rx={2.8} ry={1.5} fill={url("body")} transform={`rotate(${-tilt} ${12 - lean} ${y})`} />
                  <ellipse cx={12 - lean} cy={y} rx={2.8} ry={1.5} {...EDGE} transform={`rotate(${-tilt} ${12 - lean} ${y})`} />
                  <ellipse cx={12 + lean} cy={y} rx={2.8} ry={1.5} fill={url("body")} transform={`rotate(${tilt} ${12 + lean} ${y})`} />
                  <ellipse cx={12 + lean} cy={y} rx={2.8} ry={1.5} {...EDGE} transform={`rotate(${tilt} ${12 + lean} ${y})`} />
                </g>
              );
            })}
            {icon === "wheat" && (
              <path d="M12 6.2V2.8M9.6 6.6 7.8 3.6M14.4 6.6l1.8-3" stroke={p.mid} strokeWidth={0.9} strokeLinecap="round" fill="none" />
            )}
            <ellipse cx={12} cy={5.4} rx={1.9} ry={2.4} fill={url("body")} />
            <ellipse cx={12} cy={5.4} rx={1.9} ry={2.4} {...EDGE} />
          </>
        );
      }

      case "corn":
        return (
          <>
            {/* 껍질을 반쯤 벗긴 옥수수. 알갱이는 엇갈린 격자로 찍어야 줄무늬로 안 보인다. */}
            <path d="M6.4 13.2C5 10.4 5.4 7.6 7.2 5.2c1.4 2 2 4.4 1.8 7.2z" fill={p.dark} fillOpacity={0.5} />
            <path d="M17.6 13.2c1.4-2.8 1-5.6-.8-8-1.4 2-2 4.4-1.8 7.2z" fill={p.dark} fillOpacity={0.5} />
            <path d="M12 2.8c3.1 2.2 4.5 5.3 4.5 9s-1.8 8-4.5 8.6c-2.7-.6-4.5-4.9-4.5-8.6s1.4-6.8 4.5-9z" fill={url("body")} />
            <path d="M12 2.8c3.1 2.2 4.5 5.3 4.5 9s-1.8 8-4.5 8.6c-2.7-.6-4.5-4.9-4.5-8.6s1.4-6.8 4.5-9z" {...EDGE} />
            {[0, 1, 2, 3, 4].map((r) =>
              [-1, 0, 1].map((c) => (
                <circle
                  key={`${r}-${c}`}
                  cx={12 + c * 2 + (r % 2 ? 1 : 0)}
                  cy={6.2 + r * 2.7}
                  r={0.85}
                  fill={p.light}
                  fillOpacity={0.75}
                />
              ))
            )}
          </>
        );

      case "soybean":
        return (
          <>
            {/* 콩깍지. 앞서 그린 통통한 타원은 초록 덩어리로만 읽혔다 — 깍지를 깍지로
                만드는 건 길쭉함과, 안에 든 콩이 겉으로 밀어 올린 세 개의 혹이다. */}
            <path d="M4.4 17.4c-1.2-1.6-1-3.6.6-5.9 1.4-2 3.4-4 5.9-5.9 2.4-1.8 4.6-2.8 6.4-2.8 1.9 0 3 .9 3.3 2.4.3 1.7-.6 3.6-2.5 5.8-1.9 2.2-4 4.2-6.2 5.9-2.4 1.8-4.4 2.6-5.9 2.4-.8-.1-1.3-.7-1.6-1.9z" fill={url("body")} />
            <path d="M4.4 17.4c-1.2-1.6-1-3.6.6-5.9 1.4-2 3.4-4 5.9-5.9 2.4-1.8 4.6-2.8 6.4-2.8 1.9 0 3 .9 3.3 2.4.3 1.7-.6 3.6-2.5 5.8-1.9 2.2-4 4.2-6.2 5.9-2.4 1.8-4.4 2.6-5.9 2.4-.8-.1-1.3-.7-1.6-1.9z" {...EDGE} />
            {/* 겉으로 비치는 콩 세 알 */}
            {[
              [7.4, 14.6],
              [11.4, 11.2],
              [15.4, 7.8],
            ].map(([cx, cy], i) => (
              <g key={i}>
                <circle cx={cx} cy={cy} r={2.5} fill={p.light} fillOpacity={0.92} />
                <circle cx={cx} cy={cy} r={2.5} {...EDGE} strokeOpacity={0.22} />
                <circle cx={cx - 0.8} cy={cy - 0.8} r={0.72} fill="#fff" fillOpacity={0.8} />
              </g>
            ))}
            <path d="M18.6 4.2c.9-1 1.9-1.5 3-1.6" stroke={p.dark} strokeWidth={1.2} strokeLinecap="round" fill="none" />
          </>
        );

      case "soybean-oil":
        return (
          <>
            {/* 기름병. 방울이 아니라 병이라서 대두유는 난방유와 섞이지 않고, 병 안에
                든 콩 한 알이 어느 기름인지를 말한다. */}
            <path d="M10.4 2.6h3.2v2.8l2.6 3.2c.6.8.9 1.6.9 2.6v9c0 1.3-.8 2-2.2 2H9.1c-1.4 0-2.2-.7-2.2-2v-9c0-1 .3-1.8.9-2.6l2.6-3.2z" fill={url("body")} />
            <path d="M10.4 2.6h3.2v2.8l2.6 3.2c.6.8.9 1.6.9 2.6v9c0 1.3-.8 2-2.2 2H9.1c-1.4 0-2.2-.7-2.2-2v-9c0-1 .3-1.8.9-2.6l2.6-3.2z" {...EDGE} />
            {/* 병 안의 기름 수위 */}
            <path d="M6.9 12.4h10.2v8c0 1.3-.8 2-2.2 2H9.1c-1.4 0-2.2-.7-2.2-2z" fill={p.mid} fillOpacity={0.95} />
            <path d="M6.9 12.4h10.2" stroke="#fff" strokeOpacity={0.45} strokeWidth={0.9} fill="none" />
            <circle cx={12} cy={17.4} r={2.4} fill={p.light} />
            <circle cx={12} cy={17.4} r={2.4} {...EDGE} strokeOpacity={0.25} />
            <path d="M8.6 9.4c.6-.9 1.2-1.6 1.8-2.2" stroke="#fff" strokeOpacity={0.55} strokeWidth={1.2} strokeLinecap="round" fill="none" />
          </>
        );

      case "soybean-meal":
        return (
          <>
            {/* 갈아 쌓은 더미. 알갱이 몇 개를 표면에 얹어야 가루 무더기로 읽힌다. */}
            <path d="M3.6 19c2-5.2 4.8-7.8 8.4-7.8s6.4 2.6 8.4 7.8z" fill={url("body")} />
            <path d="M3.6 19c2-5.2 4.8-7.8 8.4-7.8s6.4 2.6 8.4 7.8z" {...EDGE} />
            <path d="M8.4 14.2c1.2-1.4 2.4-2.1 3.6-2.1" stroke="#fff" strokeOpacity={0.4} strokeWidth={1.2} strokeLinecap="round" fill="none" />
            {[
              [8.2, 16.6],
              [11.4, 15.4],
              [14.6, 16.9],
              [12.6, 17.8],
            ].map(([cx, cy], i) => (
              <circle key={i} cx={cx} cy={cy} r={0.75} fill={p.dark} fillOpacity={0.45} />
            ))}
            <ellipse cx={12} cy={7.4} rx={3.1} ry={2.4} fill={url("body")} transform="rotate(-22 12 7.4)" />
            <ellipse cx={12} cy={7.4} rx={3.1} ry={2.4} {...EDGE} transform="rotate(-22 12 7.4)" />
          </>
        );

      case "rice":
        return (
          <>
            {/* 낟알 네 알. 가운데 홈이 있어야 쌀이고, 없으면 그냥 타원이다. */}
            {[
              [8.6, 8.4, -40],
              [14.8, 10.4, 24],
              [9.4, 14.8, -12],
              [15.2, 16.6, 42],
            ].map(([cx, cy, rot], i) => (
              <g key={i} transform={`rotate(${rot} ${cx} ${cy})`}>
                <ellipse cx={cx} cy={cy} rx={3.2} ry={1.6} fill={url("body")} />
                <ellipse cx={cx} cy={cy} rx={3.2} ry={1.6} {...EDGE} />
                <path d={`M${cx - 2} ${cy} h4`} stroke={p.dark} strokeOpacity={0.5} strokeWidth={0.7} fill="none" />
                <ellipse cx={cx - 1} cy={cy - 0.6} rx={1} ry={0.4} fill="#fff" fillOpacity={0.6} />
              </g>
            ))}
          </>
        );

      case "cotton":
        return (
          <>
            {/* 목화 다래: 솜뭉치 네 덩이 아래 마른 꽃받침. 받침이 없으면 구름이 된다. */}
            <path d="M12 17.4 8.6 21.4M12 17.4l3.4 4M12 17.4v4.2" stroke={p.dark} strokeOpacity={0.75} strokeWidth={1.1} strokeLinecap="round" fill="none" />
            <circle cx={12} cy={8.2} r={3.6} fill={url("body")} />
            <circle cx={7.9} cy={12} r={3.2} fill={url("body")} />
            <circle cx={16.1} cy={12} r={3.2} fill={url("body")} />
            <circle cx={12} cy={13.6} r={3.5} fill={url("body")} />
            <circle cx={12} cy={8.2} r={3.6} {...EDGE} />
            <circle cx={7.9} cy={12} r={3.2} {...EDGE} />
            <circle cx={16.1} cy={12} r={3.2} {...EDGE} />
            <circle cx={11} cy={7.4} r={1.2} fill="#fff" fillOpacity={0.85} />
            <path d="M12 16.8 9.2 18.4M12 16.8l2.8 1.6" stroke={p.dark} strokeOpacity={0.6} strokeWidth={1.2} strokeLinecap="round" fill="none" />
          </>
        );

      case "cocoa":
        return (
          <>
            {/* 카카오 꼬투리는 세로 골이 특징이라, 골을 빼면 그냥 럭비공이 된다. */}
            <path d="M12 2.6c3.9 2 5.9 5 5.9 9.4s-2 7.4-5.9 9.4c-3.9-2-5.9-5-5.9-9.4S8.1 4.6 12 2.6z" fill={url("body")} />
            <path d="M12 2.6c3.9 2 5.9 5 5.9 9.4s-2 7.4-5.9 9.4c-3.9-2-5.9-5-5.9-9.4S8.1 4.6 12 2.6z" {...EDGE} />
            <path d="M9.2 4.6c-.6 4.9-.6 9.9 0 14.8M14.8 4.6c.6 4.9.6 9.9 0 14.8M12 3v18" stroke={p.dark} strokeOpacity={0.55} strokeWidth={0.85} fill="none" />
            <path d="M8.4 6.4c-.7 3.6-.7 7.4 0 11" stroke="#fff" strokeOpacity={0.35} strokeWidth={1.2} strokeLinecap="round" fill="none" />
          </>
        );

      case "coffee":
        return (
          <>
            {/* 원두 한 알. S자 홈과 그 안의 밝은 선이 원두를 원두로 만든다. */}
            <ellipse cx={12} cy={12} rx={5.4} ry={7.4} fill={url("body")} transform="rotate(-32 12 12)" />
            <ellipse cx={12} cy={12} rx={5.4} ry={7.4} {...EDGE} transform="rotate(-32 12 12)" />
            <path d="M7.8 16.2c1.4-1.4 1.8-2.6 1.6-4 -.2-1.6.6-3 2.8-4.4" stroke={p.dark} strokeOpacity={0.85} strokeWidth={1.5} strokeLinecap="round" fill="none" />
            <path d="M8.2 15.8c1.3-1.3 1.6-2.4 1.4-3.7-.2-1.5.5-2.7 2.6-4" stroke={p.light} strokeOpacity={0.45} strokeWidth={0.7} strokeLinecap="round" fill="none" />
            <ellipse cx={14.4} cy={8.6} rx={1.5} ry={2.2} fill="#fff" fillOpacity={0.28} transform="rotate(-32 14.4 8.6)" />
          </>
        );

      case "sugar":
        return (
          <>
            {/* 각설탕 두 개. 윗면을 따로 밝게 깔아야 결정체의 모서리가 산다. */}
            <path d="M4.2 12.4 8.6 10l4.4 2.4v5.2l-4.4 2.4-4.4-2.4z" fill={url("body")} />
            <path d="M4.2 12.4 8.6 10l4.4 2.4-4.4 2.4z" fill={url("face")} />
            <path d="M4.2 12.4 8.6 10l4.4 2.4v5.2l-4.4 2.4-4.4-2.4z" {...EDGE} />
            <path d="M8.6 14.8v5.2" {...EDGE} />
            <path d="M11 6.6 15.4 4.2l4.4 2.4v5.2l-4.4 2.4-4.4-2.4z" fill={url("body")} />
            <path d="M11 6.6 15.4 4.2l4.4 2.4-4.4 2.4z" fill={url("face")} />
            <path d="M11 6.6 15.4 4.2l4.4 2.4v5.2l-4.4 2.4-4.4-2.4z" {...EDGE} />
            <path d="M15.4 9v5.2" {...EDGE} />
            <Spark x={19.6} y={3.4} r={1.8} delay={0.4} tone="#fff" />
          </>
        );

      case "orange-juice":
        return (
          <>
            {/* 반으로 자른 오렌지. 과육 여섯 조각과 흰 속껍질까지 있어야 단면이 된다. */}
            <circle cx={12} cy={12.6} r={8.2} fill={url("body")} />
            <circle cx={12} cy={12.6} r={8.2} {...EDGE} />
            <circle cx={12} cy={12.6} r={6.6} fill="#fff" fillOpacity={0.55} />
            {[0, 60, 120, 180, 240, 300].map((a) => (
              <path
                key={a}
                d="M12 12.6 L12 6.4 A6.2 6.2 0 0 1 17.4 9.5 Z"
                fill={p.mid}
                fillOpacity={0.95}
                transform={`rotate(${a} 12 12.6)`}
              />
            ))}
            <circle cx={12} cy={12.6} r={1.1} fill="#fff" fillOpacity={0.8} />
            <path d="M14.6 4.6c1.8-1.6 3.6-1.7 5.4-.3-1.2 2-2.9 2.6-5.1 1.9z" fill="#6fa63c" />
            <path d="M14.6 4.6c1.8-1.6 3.6-1.7 5.4-.3-1.2 2-2.9 2.6-5.1 1.9z" {...EDGE} />
          </>
        );

      case "cattle":
      case "feeder-cattle": {
        // 소머리. 앞서 그린 뿔은 너무 작고 옅어서 화면에서 사라졌고, 두 계약이 나란히
        // 돼지처럼 보였다 — 뿔은 머리 밖으로 확실히 뻗어야 뿔이다. 두 계약은 같은
        // 짐승의 다른 나이이므로, 다 자란 생우는 크게 휜 뿔을, 어린 육우는 이제 막
        // 돋은 짧은 뿔과 큰 귀를 가진다.
        const grown = icon === "cattle";
        return (
          <>
            {/* 귀 — 뿔보다 뒤에 깔려 머리 옆으로 넓게 퍼진다. */}
            <ellipse cx={4.6} cy={11.4} rx={2.6} ry={1.7} fill={p.mid} transform="rotate(-24 4.6 11.4)" />
            <ellipse cx={19.4} cy={11.4} rx={2.6} ry={1.7} fill={p.mid} transform="rotate(24 19.4 11.4)" />
            <ellipse cx={4.6} cy={11.4} rx={2.6} ry={1.7} {...EDGE} transform="rotate(-24 4.6 11.4)" />
            <ellipse cx={19.4} cy={11.4} rx={2.6} ry={1.7} {...EDGE} transform="rotate(24 19.4 11.4)" />
            {/* 뿔 */}
            {grown ? (
              <>
                <path d="M7.4 7.4C5 6.4 3.4 4.6 2.6 1.9c2.6.2 4.6 1.6 5.9 4.2z" fill={p.light} />
                <path d="M16.6 7.4c2.4-1 4-2.8 4.8-5.5-2.6.2-4.6 1.6-5.9 4.2z" fill={p.light} />
                <path d="M7.4 7.4C5 6.4 3.4 4.6 2.6 1.9c2.6.2 4.6 1.6 5.9 4.2z" {...EDGE} />
                <path d="M16.6 7.4c2.4-1 4-2.8 4.8-5.5-2.6.2-4.6 1.6-5.9 4.2z" {...EDGE} />
              </>
            ) : (
              <>
                <path d="M8.2 6.6C7 5.6 6.4 4.4 6.3 2.9c1.5.5 2.4 1.6 2.8 3.2z" fill={p.light} />
                <path d="M15.8 6.6c1.2-1 1.8-2.2 1.9-3.7-1.5.5-2.4 1.6-2.8 3.2z" fill={p.light} />
                <path d="M8.2 6.6C7 5.6 6.4 4.4 6.3 2.9c1.5.5 2.4 1.6 2.8 3.2z" {...EDGE} />
                <path d="M15.8 6.6c1.2-1 1.8-2.2 1.9-3.7-1.5.5-2.4 1.6-2.8 3.2z" {...EDGE} />
              </>
            )}
            {/* 머리 — 돼지의 둥근 얼굴과 달리 위가 넓고 주둥이로 갈수록 좁아진다. */}
            <path d="M6.6 9.4c0-2.8 2.4-4.4 5.4-4.4s5.4 1.6 5.4 4.4c0 1.8-.4 3.5-1.1 4.9-.9 1.8-2.4 3-4.3 3s-3.4-1.2-4.3-3c-.7-1.4-1.1-3.1-1.1-4.9z" fill={url("body")} />
            <path d="M6.6 9.4c0-2.8 2.4-4.4 5.4-4.4s5.4 1.6 5.4 4.4c0 1.8-.4 3.5-1.1 4.9-.9 1.8-2.4 3-4.3 3s-3.4-1.2-4.3-3c-.7-1.4-1.1-3.1-1.1-4.9z" {...EDGE} />
            <path d="M8 7.6c1-1 2.4-1.5 4-1.5" stroke="#fff" strokeOpacity={0.35} strokeWidth={1.3} strokeLinecap="round" fill="none" />
            {/* 주둥이는 가로로 넓다 — 돼지코는 동그랗다. 이 하나가 둘을 가른다. */}
            <ellipse cx={12} cy={15} rx={3.4} ry={2.2} fill={p.light} fillOpacity={0.9} />
            <ellipse cx={12} cy={15} rx={3.4} ry={2.2} {...EDGE} />
            <ellipse cx={10.8} cy={14.8} rx={0.5} ry={0.7} fill={p.dark} />
            <ellipse cx={13.2} cy={14.8} rx={0.5} ry={0.7} fill={p.dark} />
            <ellipse cx={9.7} cy={10.2} rx={0.95} ry={1.1} fill={p.dark} />
            <ellipse cx={14.3} cy={10.2} rx={0.95} ry={1.1} fill={p.dark} />
            <circle cx={9.4} cy={9.9} r={0.32} fill="#fff" fillOpacity={0.9} />
            <circle cx={14} cy={9.9} r={0.32} fill="#fff" fillOpacity={0.9} />
          </>
        );
      }

      case "hog":
        return (
          <>
            {/* 돼지머리: 삼각 귀 두 개와 콧구멍 두 개. 이 넷이 없으면 그냥 분홍 타원이다. */}
            <path d="M7.2 7.8 5.4 4.2l4 1.8zM16.8 7.8l1.8-3.6-4 1.8z" fill={url("body")} />
            <path d="M7.2 7.8 5.4 4.2l4 1.8zM16.8 7.8l1.8-3.6-4 1.8z" {...EDGE} />
            <ellipse cx={12} cy={13} rx={7.2} ry={5.9} fill={url("body")} />
            <ellipse cx={12} cy={13} rx={7.2} ry={5.9} {...EDGE} />
            <path d="M7.4 9.4c1.4-1.3 3-2 4.6-2" stroke="#fff" strokeOpacity={0.4} strokeWidth={1.4} strokeLinecap="round" fill="none" />
            <ellipse cx={12} cy={14.6} rx={3.2} ry={2.5} fill={p.light} />
            <ellipse cx={12} cy={14.6} rx={3.2} ry={2.5} {...EDGE} />
            <ellipse cx={10.9} cy={14.6} rx={0.62} ry={0.85} fill={p.dark} />
            <ellipse cx={13.1} cy={14.6} rx={0.62} ry={0.85} fill={p.dark} />
            <ellipse cx={9.5} cy={10.4} rx={0.85} ry={0.95} fill={p.dark} />
            <ellipse cx={14.5} cy={10.4} rx={0.85} ry={0.95} fill={p.dark} />
          </>
        );

      case "lumber":
        return (
          <>
            {/* 통나무 두 토막. 나이테를 currentColor로 그렸더니 화면에서 지워져 두 개의
                갈색 알약만 남았다 — 나이테는 나무 자신의 어두운 색으로 그려야 보인다. */}
            <rect x={4.4} y={12.8} width={15.2} height={7} rx={3.5} fill={url("body")} />
            <rect x={4.4} y={12.8} width={15.2} height={7} rx={3.5} {...EDGE} />
            <circle cx={8} cy={16.3} r={3.5} fill={url("face")} />
            <circle cx={8} cy={16.3} r={3.5} {...EDGE} />
            <circle cx={8} cy={16.3} r={2.4} fill="none" stroke={p.dark} strokeOpacity={0.7} strokeWidth={0.85} />
            <circle cx={8} cy={16.3} r={1.3} fill="none" stroke={p.dark} strokeOpacity={0.7} strokeWidth={0.85} />
            <circle cx={8} cy={16.3} r={0.4} fill={p.dark} fillOpacity={0.8} />
            <rect x={7} y={4.4} width={13.6} height={6.8} rx={3.4} fill={url("body")} />
            <rect x={7} y={4.4} width={13.6} height={6.8} rx={3.4} {...EDGE} />
            <circle cx={10.4} cy={7.8} r={3.4} fill={url("face")} />
            <circle cx={10.4} cy={7.8} r={3.4} {...EDGE} />
            <circle cx={10.4} cy={7.8} r={2.3} fill="none" stroke={p.dark} strokeOpacity={0.7} strokeWidth={0.85} />
            <circle cx={10.4} cy={7.8} r={1.2} fill="none" stroke={p.dark} strokeOpacity={0.7} strokeWidth={0.85} />
            <circle cx={10.4} cy={7.8} r={0.4} fill={p.dark} fillOpacity={0.8} />
          </>
        );

      default:
        return (
          <>
            <circle cx={12} cy={12} r={7} fill={url("body")} />
            <circle cx={12} cy={12} r={7} {...EDGE} />
          </>
        );
    }
  }

  return (
    <svg
      className="commodity-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {body}
        {face}
        {gloss}
        {metal && sheen}
      </defs>
      {glyph()}
    </svg>
  );
}
