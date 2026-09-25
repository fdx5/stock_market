import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/LanguageContext";
import KakaoIcon from "./KakaoIcon";

/** Renders a dialog on <body>, centred on the screen. The map pages' box (.d2) is a
 * size container, which some browsers make the containing block of fixed
 * descendants — a dialog opened from far down the table view was centred on the
 * page, out of reach. The wrapper keeps the page classes the dialogs are styled
 * under and draws no box (display: contents, styles.css). */
function OnScreen({ children }: { children: ReactNode }) {
  return createPortal(<div className="d2 mm app kospi-map-page map-layer-portal">{children}</div>, document.body);
}

/* The maps' PNG export and 카카오톡 share, shared by every treemap page (the four
 * market maps and the 부동산 맵). Each page draws its own PNG — they lay out
 * different things — and hands that drawing to useMapExport; the preview modal, the
 * download link, the share sheet and the clipboard fallbacks are the same everywhere,
 * so they live here once. */

// Resolves any CSS color expression (var(), color-mix(), etc.) to its rendered
// rgb/rgba string by letting the browser compute it on a throwaway element —
// avoids hand-duplicating the theme's color formulas for the PNG export. `host` is
// where the probe is resolved: inside the map canvas, it picks up variables the
// canvas redefines (the night palette the maps keep in the 주간판).
export function resolveCssColor(value: string, host: HTMLElement = document.body): string {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;left:-9999px;top:-9999px;";
  probe.style.color = value;
  host.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  host.removeChild(probe);
  return resolved;
}

// Binary-searches the longest text-plus-ellipsis that still fits maxWidth, mirroring
// the CSS text-overflow:ellipsis the on-screen tiles get for free — canvas text has
// no such primitive, so the map PNG export needs it done by hand.
export function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = text.slice(0, mid) + ellipsis;
    if (ctx.measureText(candidate).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + ellipsis : "";
}

export function downloadTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** iOS-family browsers, where `<a download>` opens the image in a viewer instead of
 * saving it — the one platform that genuinely needs the share sheet to get a file into
 * Photos/Files.
 *
 * A user-agent test, which is normally the wrong tool, because the thing that has to
 * be known here is not detectable: `download` is present on the anchor prototype in
 * iOS Safari and simply does not do what it says. There is nothing to feature-detect.
 *
 * iPadOS reports itself as a Mac, so it is identified by a Mac that has a touchscreen.
 */
export const IS_IOS_LIKE =
  typeof navigator !== "undefined" &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

/** Android or iOS — the platforms whose OS share sheet actually lists the KakaoTalk
 * app as a file-share target. Desktop Windows/macOS route navigator.share(files) to
 * a generic system share flyout instead; that flyout's own "copy" action was tested
 * against the real KakaoTalk PC client and does not put a pasteable image on the
 * clipboard, so desktop gets its own path (see handleShareMap) rather than trusting
 * canShare() there. */
export const IS_MOBILE_LIKE = typeof navigator !== "undefined" && (/Android/i.test(navigator.userAgent) || IS_IOS_LIKE);

export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    // A ticker this host has no logo for resolves to null, exactly like a KR code whose
    // icon 404s — the tile just draws its text, which is what it did before logos.
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Draws `icon` into an `size`x`size` box the way CSS `object-fit: contain` would —
 * scaled to fit, centered, aspect preserved. Canvas has no such primitive: drawImage
 * with an explicit width and height stretches. That never showed on the KR maps because
 * Naver's icons are square, but the US logos are frequently wide wordmarks (FOX, Intel,
 * ASML), and stretching those into a square is both ugly and visibly different from the
 * tile the export is supposed to be reproducing. */
export function drawContained(
  ctx: CanvasRenderingContext2D,
  icon: HTMLImageElement,
  x: number,
  y: number,
  size: number
): void {
  const scale = Math.min(size / icon.width, size / icon.height) || 0;
  const w = icon.width * scale;
  const h = icon.height * scale;
  ctx.drawImage(icon, x + (size - w) / 2, y + (size - h) / 2, w, h);
}

/** Every map draws its tiles in the 야간판 palette, in both editions: the blue-to-red
 * scale and the no-trade tiles separate far better on the near-black ground than on
 * newsprint. The canvas carries .map-canvas-night (desk2/maps.css) to match. */
export const TILE_NIGHT_MODE = "dark" as const;

export interface MapExportOptions {
  /** Draws the map as it is on screen. null when there is nothing to draw yet. */
  render: () => Promise<Blob | null>;
  /** Downloaded filename prefix, e.g. "kospi" -> kospi_MMDDHHmmss.png */
  filePrefix: string;
  shareTitle: string;
  shareText: string;
}

export function useMapExport({ render, filePrefix, shareTitle, shareText }: MapExportOptions) {
  const t = useT();
  const [mapPreview, setMapPreview] = useState<{ blob: Blob; url: string; filename: string } | null>(null);
  // A share in flight. The ref is the one the handlers read — see confirmMapDownload
  // for why the state alone cannot close the double-tap window — and the state exists
  // only to re-render the button into its busy form.
  const sharingRef = useRef(false);
  const [sharing, setSharing] = useState(false);
  const [mapDownloadError, setMapDownloadError] = useState<string | null>(null);
  // Navigating away with the preview open otherwise leaks the PNG for the tab's
  // lifetime. Tracked through a ref and released only on unmount: a cleanup keyed on
  // `mapPreview` would revoke the live URL on StrictMode's double-invoke in dev and
  // blank the image.
  const previewUrlRef = useRef<string | null>(null);
  useEffect(() => {
    previewUrlRef.current = mapPreview?.url ?? null;
  }, [mapPreview]);
  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    []
  );

  const handleDownloadMap = async () => {
    const blob = await render();
    if (!blob) return;
    setMapPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return { blob, url: URL.createObjectURL(blob), filename: `${filePrefix}_${downloadTimestamp()}.png` };
    });
  };

  // Kakao share: on Android/iOS, hands the map PNG + link to the OS share sheet in
  // one call, and KakaoTalk's own app in that sheet takes both together. Desktop has
  // no such integration — Windows' system share flyout lists no KakaoTalk target for
  // the PC client, and its own "복사" action was tested against the real client and
  // does not leave a pasteable image on the clipboard — so desktop instead writes the
  // PNG straight to the clipboard itself (the same mechanism a screenshot paste
  // uses) and opens an anchored panel with an explicit "링크도 복사" button for the link.
  //
  // A single paste can only ever deliver one clipboard representation to the target
  // app — that's the platform's model, not something a web page can get around — so
  // the link can't ride along in the same Ctrl+V as the image. Sequencing both writes
  // automatically and leaning on Windows' clipboard history (Win+V) to recover the
  // first one was tried and dropped: that history is off by default for most visitors,
  // so the link would simply be unrecoverable for them. An explicit second click has
  // no such dependency — it copies the link only when the user asks for it, which is
  // also what avoids the earlier bug where an automatic second write silently clobbered
  // the image before it had been pasted.
  const [kakaoSharing, setKakaoSharing] = useState(false);
  const [kakaoShareCopied, setKakaoShareCopied] = useState(false);
  const [kakaoShareStage, setKakaoShareStage] = useState<"idle" | "image-copied" | "link-copied">("idle");
  const kakaoShareUrlRef = useRef("");
  const handleCopyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(kakaoShareUrlRef.current);
      setKakaoShareStage("link-copied");
      setTimeout(() => setKakaoShareStage("idle"), 4000);
    } catch {
      /* clipboard denied — leave the image-copied panel up so the user can retry */
    }
  };
  const handleShareMap = async () => {
    if (kakaoSharing) return;
    setKakaoSharing(true);
    setKakaoShareStage("idle");
    try {
      const sharedUrl = new URL(location.href);
      sharedUrl.searchParams.set("utm_source", "kakaotalk");
      sharedUrl.searchParams.set("utm_medium", "social");
      sharedUrl.searchParams.set("utm_campaign", `${filePrefix}_map`);
      const url = sharedUrl.toString();
      kakaoShareUrlRef.current = url;
      const title = shareTitle;
      const text = shareText;

      const blob = await render();
      const file = blob ? new File([blob], `${filePrefix}_${downloadTimestamp()}.png`, { type: "image/png" }) : null;

      if (IS_MOBILE_LIKE && file && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title, text, url });
        return;
      }

      if (blob && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setKakaoShareStage("image-copied");
        return;
      }

      if (navigator.share) {
        await navigator.share({ title, text, url });
        return;
      }

      await navigator.clipboard.writeText(url);
      setKakaoShareCopied(true);
      setTimeout(() => setKakaoShareCopied(false), 2000);
    } catch {
      /* user cancelled the share sheet, or clipboard was denied — no error UI for either */
    } finally {
      setKakaoSharing(false);
    }
  };

  const closeMapPreview = () => {
    // Refused while a share sheet is up. The sheet is system UI drawn over the page,
    // so a tap meant for it can land on the overlay behind — and closing here revokes
    // the object URL the share target is still reading from, which turns a working
    // save into a failure the user never asked for.
    if (sharingRef.current) return;
    setMapPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    setMapDownloadError(null);
  };

  // Whether to offer the share sheet at all. Computed at render rather than inside the
  // handler so the modal can decide what control to draw — the user should see which
  // save affordance they get, not discover it after a tap.
  //
  // Restricted to iOS-family browsers, which is narrower than "the platform can share".
  // Android can share too, but the download link beside it already saves the file
  // there, so the sheet is a redundant second path — and on at least one device (a
  // Galaxy Fold's inner display) invoking it leaves the share UI flickering and
  // unusable. A redundant control that breaks on real hardware is worth removing;
  // on iOS it is not redundant, it is the only way to save.
  const canShareMapFile = useMemo(() => {
    if (!mapPreview || !IS_IOS_LIKE) return false;
    if (typeof navigator.canShare !== "function" || typeof navigator.share !== "function") {
      return false;
    }
    try {
      const file = new File([mapPreview.blob], mapPreview.filename, { type: "image/png" });
      return navigator.canShare({ files: [file] });
    } catch {
      return false;
    }
  }, [mapPreview]);

  /** Hands the PNG to the native share sheet, where the user can save it to
   * Photos/Files. Share only — it never falls back to a download, because summoning a
   * second save UI on top of the sheet is what made this unusable on Android. */
  const shareMapImage = async () => {
    // A ref rather than the state flag alone: two taps can land in the same render and
    // `sharing` would still read false in the second handler's closure.
    if (!mapPreview || sharingRef.current) return;
    sharingRef.current = true;
    setSharing(true);
    setMapDownloadError(null);
    try {
      const file = new File([mapPreview.blob], mapPreview.filename, { type: "image/png" });
      await navigator.share({ files: [file] });
      sharingRef.current = false;
      // The sheet already confirmed the save; leaving the preview up makes the user
      // dismiss the same thing twice.
      closeMapPreview();
    } catch (err) {
      // A dismissed sheet is not a failure and needs no message.
      if ((err as Error)?.name !== "AbortError") {
        setMapDownloadError(t("저장에 실패했습니다. 이미지를 길게 눌러 저장해 주세요."));
      }
    } finally {
      sharingRef.current = false;
      setSharing(false);
    }
  };

  return {
    handleDownloadMap,
    handleShareMap,
    handleCopyShareLink,
    kakaoSharing,
    kakaoShareCopied,
    kakaoShareStage,
    setKakaoShareStage,
    mapPreview,
    closeMapPreview,
    canShareMapFile,
    shareMapImage,
    sharing,
    mapDownloadError,
    setMapDownloadError,
  };
}

export type MapExport = ReturnType<typeof useMapExport>;

/** The "MAP 다운로드" and "카카오톡 공유" buttons, with the share panel under them. */
export function MapExportButtons({ exp, disabled }: { exp: MapExport; disabled: boolean }) {
  const t = useT();
  return (
    <>
        <button
          type="button"
          className="kospi-map-download-btn"
          onClick={exp.handleDownloadMap}
          disabled={disabled}
        >
          {t("MAP 다운로드")}
        </button>
        <div className="kospi-map-share-wrap">
          <button
            type="button"
            className="kospi-map-download-btn kospi-map-share-btn"
            onClick={exp.handleShareMap}
            disabled={disabled || exp.kakaoSharing}
          >
            <KakaoIcon />
            {exp.kakaoShareCopied ? t("링크 복사됨") : exp.kakaoSharing ? t("공유 준비 중...") : t("카카오톡 공유")}
          </button>
          {exp.kakaoShareStage !== "idle" && (
            <OnScreen>
              <div className="kospi-map-share-backdrop" onClick={() => exp.setKakaoShareStage("idle")} />
              <div className="kospi-map-share-popover is-centered" role="status">
                <button
                  type="button"
                  className="kospi-map-share-popover-close"
                  onClick={() => exp.setKakaoShareStage("idle")}
                  aria-label={t("닫기")}
                >
                  ×
                </button>
                {exp.kakaoShareStage === "image-copied" ? (
                  <>
                    <p>{t("MAP 이미지가 복사되었습니다. 카카오톡 채팅창에 Ctrl+V로 붙여넣어 주세요.")}</p>
                    <button type="button" className="kospi-map-share-popover-link" onClick={exp.handleCopyShareLink}>
                      {t("링크도 복사하기")}
                    </button>
                  </>
                ) : (
                  <p>{t("링크가 복사되었습니다. 채팅창에 이어서 붙여넣어 주세요.")}</p>
                )}
              </div>
            </OnScreen>
          )}
        </div>
    </>
  );
}

/** The preview that opens on "MAP 다운로드", with the one save control that works on
 * this platform. */
export function MapPreviewModal({ exp }: { exp: MapExport }) {
  const t = useT();
  if (!exp.mapPreview) return null;
  const preview = exp.mapPreview;
  return (
    <OnScreen>
      <div className="kospi-map-preview-overlay" onClick={exp.closeMapPreview}>
        <div
          className="kospi-map-preview-modal"
          role="dialog"
          aria-modal="true"
          aria-label={t("맵 이미지 미리보기")}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="kospi-map-preview-header">
            <span>{t("맵 이미지 미리보기")}</span>
            <button
              type="button"
              className="kospi-map-preview-close"
              onClick={exp.closeMapPreview}
              disabled={exp.sharing}
              aria-label={t("닫기")}
            >
              ×
            </button>
          </div>
          <div className="kospi-map-preview-body">
            <img src={preview.url} alt={preview.filename} className="kospi-map-preview-image" />
          </div>
          <div className="kospi-map-preview-footer">
            {exp.mapDownloadError && (
              <span className="kospi-map-preview-error" role="alert">
                {exp.mapDownloadError}
              </span>
            )}
            {/* One control, whichever one actually saves on this platform. Both were
                shown at once briefly and that is worse than either alone: on iOS the
                download link navigates the page to the image instead of saving it,
                and on Android the share sheet is a redundant second path that
                misbehaves on some hardware. */}
            {exp.canShareMapFile ? (
              <button
                type="button"
                className="kospi-map-preview-share"
                onClick={exp.shareMapImage}
                disabled={exp.sharing}
                aria-busy={exp.sharing}
              >
                {exp.sharing ? t("저장 중...") : t("저장")}
              </button>
            ) : (
              /* A real anchor the user taps, not a <button> that builds a hidden one
                 and fires a synthetic .click() at it. That synthetic click was the
                 only thing here that could summon Android's system "실행" chooser,
                 and a genuine tap on a genuine link is what the browser's own
                 download path is built for. */
              <a
                className="kospi-map-preview-download"
                href={preview.url}
                download={preview.filename}
                onClick={() => exp.setMapDownloadError(null)}
              >
                {t("다운로드")}
              </a>
            )}
          </div>
        </div>
      </div>
    </OnScreen>
  );
}
