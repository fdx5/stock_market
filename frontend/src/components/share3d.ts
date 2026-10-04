/* Sharing the 3D 단지뷰 the way the map pages share (mapExport.tsx handleShareMap): a
 * picture of the view and a link that opens straight into it, full screen, at the same
 * hour and weather — shared as a link (카카오톡 공유), the picture saved on its own
 * (이미지 저장). */
import type { Weather } from "./complexScene";
import { IS_IOS_LIKE, IS_MOBILE_LIKE, downloadTimestamp } from "./mapExport";

/** /realestate-map?…&complex=…&3d=1&hour=…[&weather=…]: the region the page is on, the
 * complex, and the view's time and weather. RealEstateSheet opens the view from `3d`. */
export function view3dUrl(complexId: string, hour: number, weather: Weather): string {
  const q = new URLSearchParams(location.search);
  q.set("complex", complexId);
  q.set("3d", "1");
  q.set("hour", String(Math.round(hour * 100) / 100));
  if (weather === "clear") q.delete("weather"); else q.set("weather", weather);
  q.delete("tod"); q.delete("renderer"); q.delete("devgame");
  q.set("utm_source", "kakaotalk"); q.set("utm_medium", "social"); q.set("utm_campaign", "realestate_3d");
  return `${location.origin}/realestate-map?${q}`;
}

/** The picture to share: the frame with a caption band (the complex, when and the site). */
export async function captionedShot(frame: Blob, title: string, caption: string): Promise<Blob | null> {
  const bmp = await createImageBitmap(frame).catch(() => null);
  if (!bmp) return null;
  const scale = Math.min(1, 1600 / bmp.width), w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const band = Math.round(Math.max(56, w * 0.06));
  const c = document.createElement("canvas");
  c.width = w; c.height = h + band;
  const g = c.getContext("2d")!;
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  g.fillStyle = "#0f1a21"; g.fillRect(0, h, w, band);
  const pad = Math.round(band * 0.32);
  g.textBaseline = "middle";
  g.fillStyle = "#ffffff"; g.font = `700 ${Math.round(band * 0.34)}px "Pretendard", "Noto Sans KR", sans-serif`;
  g.fillText(`${title} · 3D 단지뷰`, pad, h + band * 0.5);
  g.fillStyle = "#a6ddf6"; g.font = `600 ${Math.round(band * 0.26)}px "Pretendard", "Noto Sans KR", sans-serif`;
  const right = `${caption} · kospimap.com`;
  g.fillText(right, w - pad - g.measureText(right).width, h + band * 0.5);
  return new Promise(resolve => c.toBlob(b => resolve(b), "image/png"));
}

export type ShareStage = "idle" | "link-copied";

/** 카카오톡 공유: the link alone. A phone's share sheet (KakaoTalk is in it); on a
 * desktop the clipboard, for Ctrl+V into the chat (the page says so). */
export async function shareLink3d(o: { url: string; title: string; text: string }): Promise<ShareStage> {
  try {
    if (IS_MOBILE_LIKE && typeof navigator.share === "function") {
      await navigator.share({ title: o.title, text: o.text, url: o.url });
      return "idle";
    }
    await navigator.clipboard.writeText(o.url);
    return "link-copied";
  } catch {
    // cancelled, or the clipboard refused: as the map does, no error for either
    return "idle";
  }
}

/** 이미지 저장: the picture of the view as a PNG. iOS-family browsers open a download
 * in a viewer instead, so there the share sheet ("이미지 저장") takes it. */
export async function saveImage3d(image: Blob, name: string): Promise<void> {
  const filename = `${name.replace(/[\\/:*?"<>|\s]+/g, "_")}_3D_${downloadTimestamp()}.png`;
  const file = new File([image], filename, { type: "image/png" });
  if (IS_IOS_LIKE && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); } catch { /* cancelled */ }
    return;
  }
  const url = URL.createObjectURL(image);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
