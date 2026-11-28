import { useId } from "react";

/** KOSPIMAP's emblem for featured menu labels. */
export default function RainbowStar() {
  const id = useId().replace(/:/g, "");
  return (
    <svg className="ng-rainbow-star" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`rs-fill-${id}`} x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--star-red, #ff5f7e)" />
          <stop offset=".18" stopColor="var(--star-orange, #ffa04d)" />
          <stop offset=".36" stopColor="var(--star-yellow, #ffe066)" />
          <stop offset=".54" stopColor="var(--star-green, #5fe3a1)" />
          <stop offset=".72" stopColor="var(--star-blue, #4cb8ff)" />
          <stop offset=".88" stopColor="var(--star-violet, #8b7bff)" />
          <stop offset="1" stopColor="var(--star-pink, #e879f9)" />
        </linearGradient>
        <radialGradient id={`rs-gloss-${id}`} cx="9" cy="8" r="9" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".75" />
          <stop offset=".55" stopColor="#fff" stopOpacity=".12" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path className="ng-rainbow-star__body" fill={`url(#rs-fill-${id})`}
        d="M12 2.6c.4 0 .75.23.92.6l2.2 4.63 5.05.66c.82.1 1.15 1.12.55 1.69l-3.7 3.5.93 5.02c.15.81-.71 1.43-1.43 1.03L12 17.3l-4.52 2.43c-.72.4-1.58-.22-1.43-1.03l.93-5.02-3.7-3.5c-.6-.57-.27-1.59.55-1.69l5.05-.66 2.2-4.63c.17-.37.52-.6.92-.6Z" />
      <path fill={`url(#rs-gloss-${id})`}
        d="M12 2.6c.4 0 .75.23.92.6l2.2 4.63 5.05.66c.82.1 1.15 1.12.55 1.69l-3.7 3.5.93 5.02c.15.81-.71 1.43-1.43 1.03L12 17.3l-4.52 2.43c-.72.4-1.58-.22-1.43-1.03l.93-5.02-3.7-3.5c-.6-.57-.27-1.59.55-1.69l5.05-.66 2.2-4.63c.17-.37.52-.6.92-.6Z" />
      <path className="ng-rainbow-star__glint" fill="#fff" d="M18.6 1.4l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5Z" />
    </svg>
  );
}
