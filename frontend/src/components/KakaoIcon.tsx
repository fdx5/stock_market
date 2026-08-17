/** KakaoTalk's chat-bubble mark, kept in Kakao's own yellow rather than
 * currentColor — the brand is only recognizable by that color, so a mono/outline
 * glyph here would read as "share" rather than "KakaoTalk". */
export default function KakaoIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? "kakao-icon"} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="12" fill="#FEE500" />
      <path
        d="M12 5.5c-4.14 0-7.5 2.62-7.5 5.86 0 2.1 1.42 3.95 3.56 5l-.9 3.3a.35.35 0 0 0 .53.39l3.86-2.56c.15.01.31.02.45.02 4.14 0 7.5-2.62 7.5-5.86s-3.36-5.86-7.5-5.86z"
        fill="#391B1B"
      />
    </svg>
  );
}
