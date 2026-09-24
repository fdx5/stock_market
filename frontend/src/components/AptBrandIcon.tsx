import { CSSProperties } from "react";

/** Apartment brand marks for the 부동산 맵's tiles, table and tooltip.
 *
 * The backend names the brand (realestate_map.BRANDS); this draws it — the brand's
 * logo where public/img/apt-brands/ has one, otherwise a monogram in its colour.
 *
 * Logo sources: Wikimedia Commons (public domain / CC0 text logos; 힐스테이트 and
 * 우미린 are CC BY-SA, credited on the page), Korean Wikipedia (롯데캐슬, 현대건설),
 * and the builders' own sites (센트레빌, 데시앙, 한화 포레나, LH, 중흥 S-클래스).
 * The e편한세상 file on Commons is the cloud alone; its wordmark was set over it. */

interface Brand {
  ko: string;
  mark: string;
  color: string;
}

export const APT_BRANDS: Record<string, Brand> = {
  acro: { ko: "아크로", mark: "A", color: "#1f1d1a" },
  dh: { ko: "디에이치", mark: "DH", color: "#2c2a26" },
  lerl: { ko: "르엘", mark: "LE", color: "#5c4526" },
  ohtier: { ko: "오티에르", mark: "O", color: "#3b3a38" },
  raemian: { ko: "래미안", mark: "R", color: "#1b5aa6" },
  xi: { ko: "자이", mark: "Xi", color: "#b5121b" },
  hillstate: { ko: "힐스테이트", mark: "H", color: "#6a4e2e" },
  prugio: { ko: "푸르지오", mark: "P", color: "#1b7a3e" },
  ipark: { ko: "아이파크", mark: "iP", color: "#d51f36" },
  eplus: { ko: "e편한세상", mark: "e", color: "#ef7d00" },
  lottecastle: { ko: "롯데캐슬", mark: "L", color: "#c8102e" },
  thesharp: { ko: "더샵", mark: "#", color: "#0070b8" },
  skview: { ko: "SK VIEW", mark: "SK", color: "#ea002c" },
  hoban: { ko: "호반", mark: "HB", color: "#004a98" },
  centreville: { ko: "센트레빌", mark: "C", color: "#00824a" },
  sujain: { ko: "수자인", mark: "S", color: "#b2002d" },
  woomi: { ko: "우미린", mark: "W", color: "#1f8fce" },
  desian: { ko: "데시앙", mark: "D", color: "#008c95" },
  starhills: { ko: "스타힐스", mark: "SH", color: "#2d3a8c" },
  hanwha: { ko: "한화 포레나", mark: "F", color: "#f37321" },
  switzen: { ko: "스위첸", mark: "SW", color: "#7a2b8f" },
  haneulchae: { ko: "하늘채", mark: "하", color: "#0081c8" },
  wive: { ko: "위브", mark: "We", color: "#0054a6" },
  haeringon: { ko: "해링턴", mark: "HP", color: "#8a1538" },
  sclass: { ko: "S-클래스", mark: "S", color: "#003e7e" },
  yuboura: { ko: "유보라", mark: "U", color: "#0096d6" },
  richeville: { ko: "리슈빌", mark: "R", color: "#004f9f" },
  poongkyungchae: { ko: "풍경채", mark: "풍", color: "#4a9b2f" },
  humansia: { ko: "LH 휴먼시아", mark: "LH", color: "#00a651" },
  hyundai: { ko: "현대", mark: "HD", color: "#002c5f" },
};

/** brand key -> logo under public/, with its width:height, so a caller can tell how
 * much of a tile the mark will take before drawing it. */
const BRAND_IMAGES: Partial<Record<string, { src: string; ratio: number }>> = {
  centreville: { src: "/img/apt-brands/centreville.png", ratio: 2.43 },
  desian: { src: "/img/apt-brands/desian.png", ratio: 1.67 },
  eplus: { src: "/img/apt-brands/eplus.png", ratio: 1.51 },
  hanwha: { src: "/img/apt-brands/hanwha.png", ratio: 3.46 },
  hillstate: { src: "/img/apt-brands/hillstate.png", ratio: 1.31 },
  humansia: { src: "/img/apt-brands/humansia.png", ratio: 2.66 },
  hyundai: { src: "/img/apt-brands/hyundai.svg", ratio: 5.62 },
  ipark: { src: "/img/apt-brands/ipark.png", ratio: 4.85 },
  lottecastle: { src: "/img/apt-brands/lottecastle.png", ratio: 1.9 },
  prugio: { src: "/img/apt-brands/prugio.png", ratio: 5.71 },
  raemian: { src: "/img/apt-brands/raemian.png", ratio: 1.46 },
  sclass: { src: "/img/apt-brands/sclass.png", ratio: 4.8 },
  skview: { src: "/img/apt-brands/skview.png", ratio: 5.27 },
  sujain: { src: "/img/apt-brands/sujain.svg", ratio: 3.68 },
  thesharp: { src: "/img/apt-brands/thesharp.png", ratio: 1.18 },
  woomi: { src: "/img/apt-brands/woomi.png", ratio: 2.82 },
  xi: { src: "/img/apt-brands/xi.png", ratio: 1.88 },
};

/** A wide wordmark is capped at this many heights and shrinks inside that box. */
const MAX_RATIO = 3.2;
const PLATE_PAD = 1;

/** How wide the mark for `brand` is drawn at height `size`, plate included. */
export function brandIconWidth(brand: string | null | undefined, size: number): number {
  if (!brand || !APT_BRANDS[brand]) return 0;
  const image = BRAND_IMAGES[brand];
  return image ? Math.round(Math.min(image.ratio, MAX_RATIO) * size) + PLATE_PAD * 2 : size;
}

export function brandLabel(key: string | null | undefined): string | null {
  return key && APT_BRANDS[key] ? APT_BRANDS[key].ko : null;
}

export default function AptBrandIcon({
  brand,
  size,
  className,
  style,
}: {
  brand: string;
  size: number;
  className?: string;
  style?: CSSProperties;
}) {
  const b = APT_BRANDS[brand];
  if (!b) return null;
  const image = BRAND_IMAGES[brand];
  if (image) {
    // Logos are drawn for a white page; on a coloured tile they sit on a white plate,
    // the way the US maps' company logos do.
    const width = brandIconWidth(brand, size);
    return (
      <img
        className={className}
        src={image.src}
        alt={b.ko}
        title={b.ko}
        width={width}
        height={size}
        loading="lazy"
        decoding="async"
        style={{
          width,
          height: size,
          flexShrink: 0,
          boxSizing: "border-box",
          padding: PLATE_PAD,
          background: "#fff",
          borderRadius: 2,
          objectFit: "contain",
          ...style,
        }}
      />
    );
  }
  const fontSize = b.mark.length > 1 ? 10.5 : 13;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      role="img"
      aria-label={b.ko}
      style={{ flexShrink: 0, ...style }}
    >
      <rect x="0.5" y="0.5" width="19" height="19" rx="4" fill={b.color} stroke="rgba(255,255,255,.85)" />
      <text
        x="10"
        y="10.5"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#fff"
        fontSize={fontSize}
        fontWeight={800}
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
        letterSpacing="-0.5"
      >
        {b.mark}
      </text>
    </svg>
  );
}
