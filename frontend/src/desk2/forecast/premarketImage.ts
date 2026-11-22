import type { PremarketGroup } from "../../api/client";
import { IMAGE_EXPORT_SOURCE, truncateToWidth } from "../../components/mapExport";
import { formatChangeRate, formatFullDate, formatMoney, probabilities, RESULT_ARROW, RESULT_CLASS } from "../../prediction";

type Labels = {
  title: string; market: string; notice: string; base: string; reliability: string;
  up: string; flat: string; down: string;
};

export async function forecastImage(
  market: PremarketGroup["market"],
  date: string,
  items: PremarketGroup["items"],
  labels: Labels,
): Promise<File> {
  const cardWidth = 420;
  const cardHeight = 182;
  const gap = 16;
  const margin = 24;
  const top = 108;
  const columns = Math.min(2, items.length);
  const width = 2 * margin + columns * cardWidth + (columns - 1) * gap;
  const height = top + Math.ceil(items.length / columns) * (cardHeight + gap) + 30;
  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Forecast image canvas unavailable");
  const ctx = context;
  ctx.scale(2, 2);
  const foreground = "#f8f2fb";
  const muted = "#c2afcd";
  const accent = "#d2a5fb";
  const colors = { up: "#ff8096", flat: "#c2afcd", down: "#83bbff" };
  const font = getComputedStyle(document.documentElement).getPropertyValue("--f-sans").trim() ||
    '"Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

  function text(value: string, x: number, y: number, size: number, color = foreground, weight = 500, max?: number) {
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.fillStyle = color;
    ctx.fillText(max === undefined ? value : truncateToWidth(ctx, value, max), x, y);
  }

  function card(x: number, y: number, direction: keyof typeof colors) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, cardWidth, cardHeight, 11);
    else ctx.rect(x, y, cardWidth, cardHeight);
    const fill = ctx.createLinearGradient(x, y, x + cardWidth, y + cardHeight);
    fill.addColorStop(0, "#2d2038");
    fill.addColorStop(1, "#1a1322");
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = "#574061";
    ctx.stroke();
    ctx.fillStyle = colors[direction];
    ctx.fillRect(x + 13, y, cardWidth - 26, 2);
  }

  ctx.fillStyle = "#15101c";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#bf85ff";
  ctx.fillRect(0, 0, width, 3);
  text(labels.title, margin, 41, 25, foreground, 750);
  text(`${labels.market} · ${formatFullDate(date)}`, margin, 66, 15, accent, 600);
  text(labels.notice, margin, 87, 12, muted, 500, width - 2 * margin);

  items.forEach((item, i) => {
    const x = margin + (i % columns) * (cardWidth + gap);
    const y = top + Math.floor(i / columns) * (cardHeight + gap);
    const left = x + 16;
    const right = x + cardWidth - 16;
    const direction = RESULT_CLASS[item.result] as keyof typeof colors;
    const p = probabilities(item);
    card(x, y, direction);
    text(item.name, left, y + 30, 19, foreground, 750, cardWidth - 32);
    text(item.code, left, y + 50, 12, muted);
    text(formatMoney(item.predict_price, market), left, y + 87, 28, foreground, 700, 245);
    ctx.textAlign = "right";
    text(`${RESULT_ARROW[item.result]} ${formatChangeRate(item.change_rate)}`, right, y + 87, 17, colors[direction], 700);
    if (item.reliability !== null) text(`${labels.reliability} ${item.reliability}`, right, y + 111, 13, muted);
    ctx.textAlign = "left";
    text(`${labels.base} ${formatMoney(item.base_price, market)}`, left, y + 111, 13, muted);

    if (p) {
      const inner = cardWidth - 32;
      let offset = left;
      for (const part of ["up", "flat", "down"] as const) {
        const size = inner * p[part] / 100;
        ctx.fillStyle = colors[part];
        ctx.fillRect(offset, y + 133, size, 4);
        offset += size;
      }
      text(`${labels.up} ${p.up}%   ·   ${labels.flat} ${p.flat}%   ·   ${labels.down} ${p.down}%`, left, y + 158, 13, muted);
    }
  });

  ctx.textAlign = "right";
  text(IMAGE_EXPORT_SOURCE, width - margin, height - 20, 13, muted, 650);
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!png) throw new Error("Could not encode forecast image");
  return new File([png], `kospimap-ai-${market.toLowerCase()}-${date}.png`, { type: "image/png" });
}
