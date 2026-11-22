import { useEffect, useRef, useState } from "react";
import type { PremarketGroup } from "../../api/client";
import KakaoIcon from "../../components/KakaoIcon";
import { IS_MOBILE_LIKE } from "../../components/mapExport";
import { useLanguage } from "../../i18n/LanguageContext";
import { forecastImage } from "./premarketImage";

export default function PremarketShareActions({ group, items, marketLabel, onCancel }: {
  group: PremarketGroup;
  items: PremarketGroup["items"];
  marketLabel: string;
  onCancel: () => void;
}) {
  const { lang } = useLanguage();
  const L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const [message, setMessage] = useState("");
  const [image, setImage] = useState<{ file: File; url: string } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const pending = useRef(false);
  const [sharing, setSharing] = useState(false);
  const { market, date } = group;

  useEffect(() => {
    setImage(null);
    setShowPreview(false);
    setMessage("");
    if (!items.length) return;
    const ko = lang === "ko";
    let cancelled = false;
    let url: string | null = null;
    // Build once per selection so the real download link and the native share tap
    // can both use the already prepared file, including on iOS.
    const timer = window.setTimeout(() => {
      forecastImage(market, date, items, {
        title: ko ? "AI 주가 예측" : "AI stock forecasts",
        market: marketLabel,
        notice: ko ? "예측은 빗나갈 수 있으니 참고용으로만 활용하세요." : "Forecasts may be inaccurate. For reference only.",
        base: ko ? "기준가" : "Base",
        reliability: ko ? "신뢰도" : "Reliability",
        up: ko ? "상승" : "Up",
        flat: ko ? "보합" : "Flat",
        down: ko ? "하락" : "Down",
      }).then((file) => {
        if (cancelled) return;
        url = URL.createObjectURL(file);
        setImage({ file, url });
      }).catch(() => {
        if (!cancelled) setMessage(ko ? "이미지를 만들지 못했습니다. 종목을 다시 선택해 주세요." : "Could not create the image. Select your stocks again.");
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
  }, [date, items, lang, market, marketLabel]);

  const share = async () => {
    if (!image || pending.current) return;
    pending.current = true;
    setSharing(true);
    setMessage("");
    try {
      const { file } = image;
      const payload = { files: [file] };
      if (IS_MOBILE_LIKE && navigator.share && navigator.canShare?.(payload)) {
        await navigator.share(payload);
      } else if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": file })]);
        setMessage(L("이미지를 복사했습니다. 카카오톡 채팅창에 붙여넣으세요.", "Image copied. Paste it into your KakaoTalk chat."));
      } else {
        setShowPreview(true);
        setMessage(L("이미지를 열어 저장한 뒤 카카오톡에서 첨부해 주세요.", "Open and save the image to attach it in KakaoTalk."));
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        setShowPreview(true);
        setMessage(L("공유하지 못했습니다. 이미지를 다운로드한 뒤 카카오톡에서 첨부해 주세요.", "Sharing failed. Download the image and attach it in KakaoTalk."));
      }
    } finally {
      pending.current = false;
      setSharing(false);
    }
  };

  return (
    <div className="ng-premarket-share-actions">
      <div className="ng-premarket-share-controls">
        <span role="status">{L(`${items.length}개 선택`, `${items.length} selected`)}</span>
        <button type="button" onClick={onCancel}>{L("취소", "Cancel")}</button>
        {image ? <a className="ng-premarket-download" href={image.url} download={image.file.name}
          onClick={() => setShowPreview(true)}>{L("이미지 다운로드", "Download image")}</a> :
          <button type="button" className="ng-premarket-download" disabled>{L("이미지 다운로드", "Download image")}</button>}
        <button type="button" className="ng-premarket-kakao" disabled={!image || sharing} onClick={share}>
          <KakaoIcon />{L("카카오톡 공유", "Share to KakaoTalk")}
        </button>
      </div>
      {(message || (showPreview && image)) && <div className="ng-premarket-share-feedback">
        {message && <span role="status">{message}</span>}
        {showPreview && image && <a href={image.url} target="_blank" rel="noopener noreferrer">{L("이미지 열기", "Open image")} ↗</a>}
      </div>}
    </div>
  );
}
