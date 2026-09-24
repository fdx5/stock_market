import { CSSProperties } from "react";

/** Apartment brand marks for the 부동산 맵's tiles.
 *
 * The backend names the brand (realestate_map.BRANDS); this draws it. What it draws by
 * default is a monogram in the brand's colour — not the builders' registered logos,
 * which this site has no licence to redistribute. Dropping an official logo file into
 * public/img/apt-brands/ and naming it in BRAND_IMAGES swaps that brand's monogram for
 * the image everywhere it appears, tiles and table alike. */

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

/** brand key -> image path under public/, for brands with an official logo on hand. */
const BRAND_IMAGES: Partial<Record<string, string>> = {};

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
    return (
      <img
        className={className}
        src={image}
        alt={b.ko}
        width={size}
        height={size}
        loading="lazy"
        style={{ background: "#fff", borderRadius: 3, objectFit: "contain", ...style }}
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
