import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../i18n/LanguageContext";

/* "☆ 즐겨찾기" in every page header. No browser lets a page add itself to the
 * bookmarks any more (only old IE's window.external.AddFavorite ever did), so the
 * button does what the major Korean portals do: it says exactly how, for the device
 * in hand — the shortcut on a computer (and notices when it is pressed), the steps
 * for Safari, Chrome, Samsung Internet on a phone, and what to do inside the
 * KakaoTalk or NAVER app, where adding a bookmark is not possible at all. */

type Device = "desktop" | "ios" | "android" | "samsung" | "inapp";

function detectDevice(): { device: Device; mac: boolean } {
  const ua = navigator.userAgent;
  const mac = /Mac/i.test(navigator.platform || ua);
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (/KAKAOTALK|NAVER\(inapp|; wv\)|Instagram|FBAN|FBAV|Line\//i.test(ua)) return { device: "inapp", mac };
  if (ios) return { device: "ios", mac };
  if (/SamsungBrowser/i.test(ua)) return { device: "samsung", mac };
  if (/Android/i.test(ua)) return { device: "android", mac };
  return { device: "desktop", mac };
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg className="bm-star" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        d="M12 3.2l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.5l6-.8z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" className="bm-inline-icon">
      <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11H5v10h14V11h-1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function BookmarkButton({ className = "" }: { className?: string }) {
  const { lang } = useLanguage();
  const L = (ko: string, en: string) => (lang === "ko" ? ko : en);
  const { device, mac } = useMemo(detectDevice, []);
  const phone = device !== "desktop";
  const [open, setOpen] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      // The reader pressed the shortcut: the browser's own bookmark dialog is up.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        setPressed(true);
        window.setTimeout(() => setOpen(false), 2600);
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!phone && wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open, phone]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(L("이 주소를 복사해 주세요", "Copy this address"), window.location.href);
    }
  };

  const key = mac ? "⌘" : "Ctrl";
  const steps: Record<Exclude<Device, "desktop">, JSX.Element> = {
    ios: (
      <ol>
        <li>
          {L("Safari 아래(또는 위) 막대의 공유 버튼", "Tap Safari's Share button")} <ShareIcon /> {L("을 누르세요.", "in the toolbar.")}
        </li>
        <li>{L("‘북마크 추가’ 또는 ‘즐겨찾기에 추가’를 고르세요.", "Choose ‘Add Bookmark’ or ‘Add to Favourites’.")}</li>
        <li>{L("홈 화면 아이콘으로 두려면 ‘홈 화면에 추가’를 고르세요.", "For an icon on your home screen, choose ‘Add to Home Screen’.")}</li>
      </ol>
    ),
    android: (
      <ol>
        <li>{L("Chrome 오른쪽 위 ⋮ 메뉴를 누르세요.", "Tap the ⋮ menu at the top right of Chrome.")}</li>
        <li>{L("맨 위의 ☆ 별표를 누르면 북마크에 추가됩니다.", "Tap the ☆ star at the top to bookmark the page.")}</li>
        <li>{L("홈 화면 아이콘으로 두려면 ‘홈 화면에 추가’를 누르세요.", "For a home-screen icon, tap ‘Add to Home screen’.")}</li>
      </ol>
    ),
    samsung: (
      <ol>
        <li>{L("아래쪽 ≡ 메뉴를 누르세요.", "Tap the ≡ menu at the bottom.")}</li>
        <li>{L("‘북마크 추가’를 누르면 즐겨찾기에 추가됩니다.", "Tap ‘Add bookmark’.")}</li>
        <li>{L("홈 화면에 두려면 ‘현재 페이지 추가 → 홈 화면’을 누르세요.", "For a home-screen icon, tap ‘Add page to → Home screen’.")}</li>
      </ol>
    ),
    inapp: (
      <ol>
        <li>{L("카카오톡·네이버 등 앱 안의 브라우저에서는 즐겨찾기를 추가할 수 없습니다.", "Bookmarks can't be added inside the KakaoTalk or NAVER app.")}</li>
        <li>{L("오른쪽 위(또는 아래) 메뉴에서 ‘다른 브라우저로 열기’를 누르세요.", "Use the app's menu to ‘Open in browser’.")}</li>
        <li>{L("열린 브라우저에서 이 버튼을 다시 누르면 방법을 안내해 드립니다.", "Then tap this button again there for the steps.")}</li>
      </ol>
    ),
  };

  const card = (
    <div
      className={`bm-card${phone ? " bm-card--sheet" : ""}`}
      role="dialog"
      aria-label={L("즐겨찾기에 추가", "Add a bookmark")}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <header>
        <StarIcon filled />
        <strong>{L("이 페이지를 즐겨찾기에 추가", "Bookmark this page")}</strong>
        <button type="button" className="bm-close" onClick={() => setOpen(false)} aria-label={L("닫기", "Close")}>
          ×
        </button>
      </header>
      {phone ? (
        steps[device as Exclude<Device, "desktop">]
      ) : pressed ? (
        <p className="bm-done">{L("즐겨찾기 창이 열렸습니다. ‘완료’ 또는 ‘저장’을 누르면 추가됩니다.", "Your browser's bookmark dialog is open — press Done to save.")}</p>
      ) : (
        <p className="bm-keys">
          {L("키보드에서", "Press")} <kbd>{key}</kbd> + <kbd>D</kbd> {L("를 누르면 즐겨찾기에 추가됩니다.", "to bookmark this page.")}
        </p>
      )}
      {!phone && !pressed && (
        <p className="bm-note">{L("브라우저 보안 정책상 버튼으로 바로 추가할 수 없어 단축키를 안내해 드립니다.", "Browsers don't let a page bookmark itself, so here is the shortcut.")}</p>
      )}
      <button type="button" className="bm-copy" onClick={copy}>
        {copied ? L("주소가 복사되었습니다", "Address copied") : L("페이지 주소 복사", "Copy page address")}
      </button>
    </div>
  );

  return (
    <span className={`bm-wrap ${className}`} ref={wrapRef}>
      <button
        type="button"
        className={`bm-btn${open ? " is-open" : ""}`}
        onClick={() => {
          setPressed(false);
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={L("이 페이지를 즐겨찾기에 추가", "Bookmark this page")}
      >
        <StarIcon filled={open} />
        <span>{L("즐겨찾기", "Bookmark")}</span>
      </button>
      {open &&
        (phone
          ? createPortal(
              <div className="bm-layer">
                <div className="bm-scrim" onClick={() => setOpen(false)} />
                {card}
              </div>,
              document.body,
            )
          : card)}
    </span>
  );
}
