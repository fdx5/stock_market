import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STORY_BOOKS, type BookPage, type PageChart, type StoryBook } from "./interior/books";
import { BOOK_ART, type ArtScene } from "./interior/bookArt";

/* A book read on the screen as a book: closed on its cover, opened by turning the cover; two pages at
 * a time on paper with its grain, the spine's shadow and the edges of the pages under; each leaf
 * turned by a click or by dragging its corner, the turning page shaded as it curls over and casting
 * its shadow on the page beneath, with the sound of a page (recorded, CC0 — SOURCES.md). The tales
 * illustrated page by page: a scene (night, sea, forest, palace, snow, fields) and its people and
 * things, drawn from the words; the study's book with its charts. */

const PAGE_SOUNDS = ["page1", "page2", "page3", "page4", "page5", "page6"].map(n => `/3d/walk/sfx/${n}.mp3`);
function rustle(heavy = false) {
  try { const a = new Audio(PAGE_SOUNDS[Math.floor(Math.random() * PAGE_SOUNDS.length)]); a.volume = heavy ? 0.9 : 0.7; a.playbackRate = heavy ? 0.82 : 0.92 + Math.random() * 0.18; void a.play(); } catch { /* no audio */ }
}
const asPage = (p: string | BookPage): BookPage => typeof p === "string" ? { text: p } : p;

// ------------------------------------------------------------------ illustrations
const CAST: [RegExp, string][] = [
  [/제비/, "🐦"], [/박씨|박을|박이|박마다/, "🎃"], [/호랑이/, "🐯"], [/떡/, "🍡"], [/토끼/, "🐰"], [/거북/, "🐢"], [/자라|별주부/, "🐢"], [/용왕/, "🐉"], [/사슴/, "🦌"], [/선녀/, "🧚"], [/나무꾼/, "🪓"], [/도깨비/, "👹"],
  [/산신령/, "🧙"], [/금도끼|금은보화|보화|보물|보석/, "💰"], [/까치/, "🐦‍⬛"], [/구렁이|뱀/, "🐍"], [/종/, "🔔"], [/볏단|벼|논/, "🌾"], [/팥죽/, "🥣"], [/알밤/, "🌰"], [/두꺼비/, "🐸"], [/참새/, "🐤"],
  [/꽃신|유리 구두|구두/, "👠"], [/원님|왕자/, "🤴"], [/공주|신데렐라/, "👸"], [/요정/, "🧚"], [/마차|호박/, "🎃"], [/마녀/, "🧙‍♀️"], [/사과/, "🍎"], [/난쟁이/, "⛏️"], [/거울/, "🪞"],
  [/과자|사탕|케이크/, "🍬"], [/늑대/, "🐺"], [/사냥꾼/, "🏹"], [/바구니|포도주|빵/, "🧺"], [/백조/, "🦢"], [/오리/, "🦆"], [/인어/, "🧜‍♀️"], [/성냥|난로|불꽃/, "🔥"], [/임금|여왕/, "👑"],
  [/돼지/, "🐷"], [/벽돌/, "🧱"], [/당나귀/, "🫏"], [/수탉|닭/, "🐓"], [/고양이/, "🐱"], [/개(가|는|를|와|도)|강아지|토토/, "🐶"], [/도둑/, "🦹"], [/인형|피노키오/, "🪆"], [/고래/, "🐋"],
  [/소인|걸리버/, "🧍"], [/거인/, "🗿"], [/독수리/, "🦅"], [/시계/, "⏰"], [/카드/, "🃏"], [/버섯|애벌레/, "🍄"], [/모자 장수|티 파티/, "🎩"], [/회오리/, "🌪️"], [/허수아비/, "🌾"], [/양철/, "🤖"], [/사자/, "🦁"],
  [/할머니|할멈/, "👵"], [/할아버지|영감/, "👴"], [/엄마|어머니/, "👩"], [/아버지/, "👨"], [/소녀|누이|동생|딸|그레텔|도로시|앨리스|빨간 모자/, "👧"], [/소년|오빠|헨젤|아우|형/, "👦"], [/선비/, "🧑‍🎓"],
  [/배가|배 위|함대|항해/, "⛵"], [/별|별이/, "⭐"], [/편지/, "✉️"], [/학교|책/, "📚"], [/음악|노래/, "🎵"], [/눈물|울/, "💧"], [/웃/, "😊"],
];
/* Each page's picture as BOOK_ART directs it: the place painted in layers (far, middle, near), the
 * cast set in it — the one the page is about largest and in front — moving gently (breathing,
 * swaying, floating), the place alive too (stars twinkling, snow and petals falling, waves and
 * clouds drifting, bubbles rising), and a speech bubble where the page has a line said aloud. */
const SKY: Record<ArtScene, [string, string]> = {
  hanok: ["#9fd3f2", "#eaf6fd"], room: ["#f4e2c4", "#fbf0dc"], palace: ["#ffd6a5", "#fff2dc"], castle: ["#b9d8ff", "#eef6ff"], ballroom: ["#3b1f4d", "#7a3e7f"],
  forest: ["#b7e4c7", "#eef9f1"], mountain: ["#a9d6f5", "#edf7fd"], field: ["#bde0fe", "#fffbe6"], night: ["#0f1c3f", "#36407a"], sea: ["#7cc6ff", "#e2f5ff"],
  under: ["#0b4f7a", "#1f8fb8"], river: ["#a8dcff", "#effaff"], snow: ["#9db4cf", "#e6eef7"], sky: ["#6fb8ff", "#e3f3ff"], meadow: ["#a7d8ff", "#f1fbff"],
  town: ["#ffd8b1", "#fff3e3"], office: ["#d9e4f2", "#f3f7fc"], market: ["#ffe0a8", "#fff6e3"], cave: ["#1d1a2e", "#3b3355"],
};
function sceneFromText(text: string): ArtScene {
  if (/밤|달빛|달이|별|그믐|한밤/.test(text)) return "night";
  if (/바닷속|용궁|물속/.test(text)) return "under";
  if (/바다|폭풍|해변|고래/.test(text)) return "sea";
  if (/연못|강|시냇물|우물/.test(text)) return "river";
  if (/눈이|겨울|얼음|추위/.test(text)) return "snow";
  if (/왕궁|궁|무도회|성|재판정|정원/.test(text)) return "castle";
  if (/하늘|날아|구름|회오리/.test(text)) return "sky";
  if (/숲|나무/.test(text)) return "forest"; if (/산|고개/.test(text)) return "mountain";
  if (/집|방|부엌|아궁이|오두막/.test(text)) return "room";
  return "meadow";
}
const quoteOf = (t: string) => { const m = t.match(/"([^"]{2,40})"/); if (!m) return null; const q = m[1].split(/[.!?]\s/)[0].replace(/[.!?]$/, ""); return q.length > 15 ? q.slice(0, 14) + "…" : q + (/[!?~]$/.test(m[1]) ? "" : ""); };

function Backdrop({ scene, r }: { scene: ArtScene; id?: string; r: (k: number) => number }) {
  const W = 400, H = 220;
  const hills = (c1: string, c2: string, c3: string) => <>
    <path d={`M0 128 C60 ${96 + r(1) * 14} 120 ${100 + r(2) * 14} 190 ${114} S330 ${92 + r(3) * 10} 400 108 V${H} H0Z`} fill={c1} opacity="0.8" />
    <path d={`M0 150 C80 ${128 + r(4) * 10} 160 ${140} 240 ${138} S350 ${126 + r(5) * 10} 400 140 V${H} H0Z`} fill={c2} />
    <path d={`M0 176 C100 160 200 172 290 166 S380 158 400 164 V${H} H0Z`} fill={c3} /></>;
  const tufts = (c: string) => Array.from({ length: 14 }, (_, i) => { const x = r(i + 30) * W, y = 182 + r(i + 50) * 34; return <path key={i} d={`M${x} ${y} l3 -9 l2 9 l3 -7 l2 7`} stroke={c} strokeWidth="1.6" fill="none" />; });
  const flowers = (n: number) => Array.from({ length: n }, (_, i) => { const x = r(i + 70) * W, y = 186 + r(i + 90) * 30, c = ["#ff8fab", "#ffd166", "#ffffff", "#c77dff"][i % 4]; return <g key={i} className="a-sway" style={{ animationDelay: `${-r(i) * 3}s` }}><circle cx={x} cy={y} r="3.2" fill={c} /><circle cx={x} cy={y} r="1.3" fill="#ffb703" /></g>; });
  const cloud = (x: number, y: number, s: number, i: number) => <g key={`c${i}`} className="a-drift" style={{ animationDuration: `${26 + i * 7}s`, animationDelay: `${-i * 9}s` }}><g transform={`translate(${x} ${y}) scale(${s})`} opacity="0.92"><ellipse cx="0" cy="0" rx="34" ry="13" fill="#fff" /><ellipse cx="-16" cy="-6" rx="18" ry="13" fill="#fff" /><ellipse cx="12" cy="-9" rx="20" ry="15" fill="#fff" /></g></g>;
  const sun = <g className="a-spin-slow"><circle cx="338" cy="44" r="22" fill="#ffd166" />{Array.from({ length: 12 }, (_, i) => <rect key={i} x="337" y="10" width="2.5" height="10" rx="1" fill="#ffd166" transform={`rotate(${i * 30} 338 44)`} />)}</g>;
  const hanokRoof = (x: number, y: number, w: number, c = "#4a4e57") => <path d={`M${x - 10} ${y + 10} Q${x + w / 2} ${y - 6} ${x + w + 10} ${y + 10} L${x + w + 2} ${y + 4} Q${x + w / 2} ${y - 18} ${x - 2} ${y + 4}Z`} fill={c} />;
  const pine = (x: number, y: number, s: number, c = "#2d6a4f", i = 0) => <g key={`p${i}`} transform={`translate(${x} ${y}) scale(${s})`} className="a-sway-tree" style={{ animationDelay: `${-i * 0.7}s` }}><rect x="-3" y="0" width="6" height="22" fill="#6b4423" /><path d="M-22 4 L0 -34 L22 4Z" fill={c} /><path d="M-17 -12 L0 -46 L17 -12Z" fill={c} /></g>;
  switch (scene) {
    case "night": return <>
      {Array.from({ length: 34 }, (_, i) => <circle key={i} className="a-twinkle" style={{ animationDelay: `${-r(i + 5) * 3}s` }} cx={r(i) * W} cy={r(i + 40) * 120} r={r(i + 80) * 1.5 + 0.5} fill="#fff8d6" />)}
      <g><circle cx="320" cy="48" r="26" fill="#fff3b0" /><circle cx="320" cy="48" r="38" fill="#fff3b0" opacity="0.12" /><circle cx="312" cy="42" r="4" fill="#efe1a0" /><circle cx="328" cy="56" r="3" fill="#efe1a0" /></g>
      {hills("#22325e", "#1a2a4a", "#14213d")}
      {Array.from({ length: 6 }, (_, i) => <circle key={`f${i}`} className="a-firefly" style={{ animationDelay: `${-i * 1.3}s` }} cx={40 + r(i + 11) * 320} cy={150 + r(i + 21) * 40} r="1.8" fill="#f9f871" />)}</>;
    case "under": return <>
      {Array.from({ length: 5 }, (_, i) => <path key={i} d={`M${60 + i * 80} 0 L${90 + i * 80} 0 L${40 + i * 70} 220 L${20 + i * 70} 220Z`} fill="#ffffff" opacity="0.07" />)}
      <path d="M0 190 Q100 176 200 188 T400 184 V220 H0Z" fill="#e9c46a" />
      {Array.from({ length: 7 }, (_, i) => <path key={`s${i}`} className="a-sway" style={{ animationDelay: `${-i * 0.6}s` }} d={`M${20 + i * 58} 200 q-8 -20 0 -40 q8 -20 0 -40`} stroke="#2a9d8f" strokeWidth="5" fill="none" strokeLinecap="round" />)}
      {Array.from({ length: 12 }, (_, i) => <circle key={`b${i}`} className="a-bubble" style={{ animationDelay: `${-r(i + 7) * 6}s`, animationDuration: `${4 + r(i) * 4}s` }} cx={r(i + 3) * W} cy="210" r={2 + r(i + 9) * 4} fill="none" stroke="#e0fbfc" strokeWidth="1.2" />)}
      <path d="M300 190 l10 -40 l10 40Z M318 190 l14 -60 l14 60Z" fill="#c8553d" opacity="0.8" /></>;
    case "sea": return <>
      {sun}{cloud(80, 50, 1, 0)}{cloud(220, 34, 0.7, 1)}
      <rect y="118" width={W} height="102" fill="#3a86ff" opacity="0.8" />
      {Array.from({ length: 4 }, (_, i) => <path key={i} className="a-wave" style={{ animationDelay: `${-i * 0.8}s` }} d={`M-40 ${130 + i * 22} q20 -8 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0`} stroke="#e0f4ff" strokeWidth="2" fill="none" opacity={0.8 - i * 0.15} />)}</>;
    case "river": return <>
      {sun}{cloud(90, 46, 0.9, 0)}{hills("#a7c957", "#6a994e", "#80b918")}
      <path d="M0 170 Q120 150 200 168 T400 160 V200 Q300 192 200 200 T0 205Z" fill="#4ea8de" />
      {Array.from({ length: 6 }, (_, i) => <path key={i} className="a-flow" style={{ animationDelay: `${-i * 0.7}s` }} d={`M${20 + i * 64} ${180 + (i % 2) * 8} h22`} stroke="#e0f4ff" strokeWidth="2" strokeLinecap="round" />)}
      {Array.from({ length: 8 }, (_, i) => <path key={`r${i}`} className="a-sway" style={{ animationDelay: `${-i * 0.4}s` }} d={`M${10 + i * 12} 172 q2 -18 -2 -30`} stroke="#606c38" strokeWidth="2" fill="none" />)}</>;
    case "snow": return <>
      {hills("#e9eef5", "#dfe7f1", "#f7f9fc")}
      <g>{hanokRoof(250, 120, 90, "#5c677d")}<rect x="256" y="128" width="78" height="40" fill="#a68a64" /><path d="M244 124 Q295 108 346 124" stroke="#fff" strokeWidth="5" fill="none" /></g>
      {Array.from({ length: 40 }, (_, i) => <circle key={i} className="a-snow" style={{ animationDelay: `${-r(i + 2) * 6}s`, animationDuration: `${5 + r(i) * 5}s` }} cx={r(i + 60) * W} cy="-6" r={1 + r(i + 33) * 2} fill="#fff" />)}</>;
    case "sky": return <>
      {sun}{cloud(70, 70, 1.2, 0)}{cloud(200, 120, 1, 1)}{cloud(320, 160, 1.3, 2)}{cloud(140, 180, 0.9, 3)}</>;
    case "office": return <>
      <rect x="20" y="20" width="160" height="110" rx="6" fill="#bcd4ee" /><g opacity="0.8">{Array.from({ length: 9 }, (_, i) => <rect key={i} x={28 + i * 17} y={130 - (20 + r(i) * 70)} width="13" height={20 + r(i) * 70} fill="#7a93b8" />)}</g>
      <rect x="0" y="160" width={W} height="60" fill="#c9b79c" /><rect x="180" y="140" width="200" height="16" rx="4" fill="#8d6e63" />
      <rect x="230" y="70" width="110" height="66" rx="6" fill="#1d2b3a" /><polyline className="a-chart" points="240,124 260,112 278,118 296,96 314,102 330,82" fill="none" stroke="#5ef0ff" strokeWidth="3" /></>;
    case "market": return <>
      <rect x="20" y="24" width="360" height="54" rx="8" fill="#1d2b3a" />{Array.from({ length: 6 }, (_, i) => <text key={i} x={36 + i * 58} y="58" fontSize="13" fontWeight="800" fill={i % 2 ? "#ff6b6b" : "#06d6a0"} className="a-blink" style={{ animationDelay: `${-i * 0.4}s` }}>{i % 2 ? "▼" : "▲"}{(r(i) * 3).toFixed(1)}%</text>)}
      <rect y="150" width={W} height="70" fill="#d4a373" />{[40, 150, 260].map((x, i) => <g key={i}><rect x={x} y="110" width="90" height="44" fill="#fefae0" /><path d={`M${x - 6} 112 h102 l-8 -18 h-86Z`} fill={["#e63946", "#2a9d8f", "#f4a261"][i]} /></g>)}</>;
    case "cave": return <>{Array.from({ length: 10 }, (_, i) => <circle key={i} className="a-twinkle" cx={r(i) * W} cy={r(i + 3) * 220} r="1.5" fill="#c9b6ff" />)}<ellipse cx="200" cy="120" rx="150" ry="100" fill="#120f1f" opacity="0.7" /></>;
    case "room": return <>
      <rect width={W} height="160" fill="#f6e7c8" />
      {[30, 130].map((x, k) => <g key={k}><rect x={x} y="22" width="80" height="110" fill="#fdf8ec" stroke="#8d6e63" strokeWidth="4" />{Array.from({ length: 3 }, (_, i) => <line key={i} x1={x + 20 * (i + 1)} y1="22" x2={x + 20 * (i + 1)} y2="132" stroke="#8d6e63" strokeWidth="2" />)}{Array.from({ length: 4 }, (_, i) => <line key={`h${i}`} x1={x} y1={22 + 22 * (i + 1)} x2={x + 80} y2={22 + 22 * (i + 1)} stroke="#8d6e63" strokeWidth="2" />)}</g>)}
      <rect y="160" width={W} height="60" fill="#e9c46a" /><rect y="160" width={W} height="6" fill="#bc6c25" opacity="0.5" />
      <g transform="translate(300 100)"><rect x="0" y="0" width="70" height="60" rx="6" fill="#6f4518" /><rect x="10" y="12" width="50" height="14" fill="#9c6644" /><rect x="10" y="34" width="50" height="14" fill="#9c6644" /></g></>;
    case "ballroom": return <>
      {[40, 120, 280, 360].map((x, i) => <rect key={i} x={x - 8} y="20" width="16" height="150" fill="#f1e3f3" opacity="0.9" />)}
      <g className="a-sway-slow"><line x1="200" y1="0" x2="200" y2="30" stroke="#d4af37" strokeWidth="2" /><ellipse cx="200" cy="40" rx="40" ry="12" fill="#ffd166" />{Array.from({ length: 7 }, (_, i) => <circle key={i} className="a-twinkle" style={{ animationDelay: `${-i * 0.3}s` }} cx={168 + i * 10.5} cy="52" r="3" fill="#fff8d6" />)}</g>
      {Array.from({ length: 10 }, (_, i) => <rect key={`t${i}`} x={i * 40} y="170" width="40" height="50" fill={i % 2 ? "#2b1438" : "#f1e3f3"} opacity="0.85" />)}
      {Array.from({ length: 12 }, (_, i) => <circle key={`s${i}`} className="a-twinkle" style={{ animationDelay: `${-r(i) * 2}s` }} cx={r(i + 4) * W} cy={60 + r(i + 8) * 100} r="1.6" fill="#ffd6ff" />)}</>;
    case "castle": return <>
      {sun}{cloud(80, 44, 1, 0)}{hills("#b5e48c", "#99d98c", "#76c893")}
      <g transform="translate(210 40)"><rect x="20" y="40" width="130" height="90" fill="#e8e0d0" /><rect x="0" y="20" width="36" height="110" fill="#ddd3c0" /><rect x="134" y="20" width="36" height="110" fill="#ddd3c0" />
        <path d="M-4 22 L18 -12 L40 22Z M130 22 L152 -12 L174 22Z" fill="#5e60ce" /><rect x="70" y="80" width="30" height="50" rx="15" fill="#6d4c41" />
        <g className="a-flag"><line x1="18" y1="-12" x2="18" y2="-34" stroke="#555" strokeWidth="2" /><path d="M18 -34 h18 l-4 6 l4 6 h-18Z" fill="#ef476f" /></g>
        {Array.from({ length: 6 }, (_, i) => <rect key={i} x={30 + i * 20} y="30" width="12" height="10" fill="#e8e0d0" />)}</g></>;
    case "palace": return <>
      {sun}{cloud(90, 40, 0.9, 0)}{hills("#cdb4db", "#b5a089", "#d4a373")}
      <g transform="translate(200 70)"><rect x="10" y="40" width="160" height="70" fill="#c1121f" /><rect x="20" y="50" width="140" height="60" fill="#780000" opacity="0.3" />
        {hanokRoof(0, 30, 180, "#2b2d42")}{hanokRoof(30, 4, 120, "#2b2d42")}{[24, 64, 104, 144].map(x => <rect key={x} x={x} y="44" width="8" height="66" fill="#9d0208" />)}<rect x="74" y="70" width="32" height="40" fill="#3d2b1f" /></g></>;
    case "hanok": return <>
      {sun}{cloud(80, 42, 0.9, 0)}{cloud(220, 30, 0.6, 1)}{hills("#95d5b2", "#74c69d", "#b7e4c7")}
      <g transform="translate(230 92)">{hanokRoof(0, 0, 130)}<rect x="8" y="10" width="114" height="56" fill="#f1dca7" /><rect x="8" y="10" width="114" height="6" fill="#8d6e63" />
        {[20, 52, 84].map(x => <g key={x}><rect x={x} y="22" width="24" height="34" fill="#fdf8ec" stroke="#8d6e63" strokeWidth="2" /><line x1={x + 12} y1="22" x2={x + 12} y2="56" stroke="#8d6e63" /><line x1={x} y1="39" x2={x + 24} y2="39" stroke="#8d6e63" /></g>)}</g>
      <path d="M0 176 h400" stroke="#b08968" strokeWidth="10" />{Array.from({ length: 20 }, (_, i) => <rect key={i} x={i * 20 + 2} y="170" width="16" height="10" rx="3" fill="#ddb892" />)}
      <g transform="translate(60 120)" className="a-sway-tree"><rect x="-3" y="0" width="6" height="50" fill="#6b4423" /><circle cx="0" cy="-6" r="24" fill="#52b788" />{[[-10, -8], [8, 2], [4, -16]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="4" fill="#f77f00" />)}</g></>;
    case "town": return <>
      {sun}{cloud(60, 40, 0.8, 0)}
      {[0, 70, 140, 210, 280, 340].map((x, i) => <g key={i}><rect x={x} y={90 - (i % 3) * 12} width="64" height={110 + (i % 3) * 12} fill={["#ffcad4", "#f4acb7", "#cdb4db", "#ffe5d9", "#bde0fe", "#ffd6a5"][i]} /><path d={`M${x - 4} ${92 - (i % 3) * 12} L${x + 32} ${66 - (i % 3) * 12} L${x + 68} ${92 - (i % 3) * 12}Z`} fill="#9d4edd" opacity="0.7" /><rect x={x + 12} y={110} width="14" height="18" fill="#fff8e7" /><rect x={x + 38} y={110} width="14" height="18" fill="#fff8e7" /></g>)}
      <rect y="190" width={W} height="30" fill="#adb5bd" /></>;
    case "mountain": return <>
      {sun}{cloud(110, 50, 0.9, 0)}
      <path d="M0 150 L70 70 L130 130 L200 50 L270 120 L330 76 L400 140 V220 H0Z" fill="#8aa1b1" opacity="0.7" />
      <path d="M0 170 L90 100 L160 150 L240 90 L320 150 L400 120 V220 H0Z" fill="#52796f" />
      <path d="M200 50 L186 66 L196 64 L204 72 L214 62 Z" fill="#fff" opacity="0.9" />
      {[30, 70, 330, 370].map((x, i) => pine(x, 168 + (i % 2) * 8, 0.8, "#2d6a4f", i))}</>;
    case "field": return <>
      {sun}{cloud(90, 46, 1, 0)}{cloud(250, 30, 0.7, 1)}
      <path d="M0 120 L400 110 V220 H0Z" fill="#e9c46a" />
      {Array.from({ length: 7 }, (_, i) => <path key={i} d={`M0 ${130 + i * 13} L400 ${122 + i * 15}`} stroke="#d4a017" strokeWidth="3" opacity="0.6" />)}
      {Array.from({ length: 16 }, (_, i) => <path key={`w${i}`} className="a-sway" style={{ animationDelay: `${-i * 0.3}s` }} d={`M${10 + i * 25} 200 q2 -16 6 -22`} stroke="#bc6c25" strokeWidth="2" fill="none" />)}</>;
    case "forest": return <>
      <path d="M0 0 L60 0 L140 220 L80 220Z M200 0 L240 0 L300 220 L250 220Z" fill="#ffffff" opacity="0.14" />
      {hills("#95d5b2", "#52b788", "#40916c")}
      {[20, 70, 120, 290, 340, 385].map((x, i) => pine(x, 150 + (i % 3) * 10, 1 - (i % 3) * 0.12, ["#1b4332", "#2d6a4f", "#40916c"][i % 3], i))}
      {tufts("#1b4332")}</>;
    default: return <>
      {sun}{cloud(80, 50, 1, 0)}{cloud(230, 36, 0.7, 1)}{hills("#b5e48c", "#99d98c", "#76c893")}{tufts("#52b788")}{flowers(12)}
      {Array.from({ length: 3 }, (_, i) => <text key={`bf${i}`} className="a-flutter" style={{ animationDelay: `${-i * 1.7}s` }} x={80 + i * 110} y={110 + i * 12} fontSize="14">🦋</text>)}</>;
  }
}

function Illustration({ text, icon, seed, lite, book, n }: { text: string; icon: string; seed: number; lite?: boolean; book: string; n: number }) {
  const spec = BOOK_ART[book]?.[n];
  const scene = spec?.[0] ?? sceneFromText(text), [a, b] = SKY[scene];
  const cast = useMemo(() => {
    if (spec) return spec[1].split(/\s+/).filter(Boolean).slice(0, 6);
    const out: string[] = []; for (const [re, e] of CAST) if (re.test(text) && !out.includes(e)) out.push(e); return (out.length ? out : [icon]).slice(0, 4);
  }, [spec, text, icon]);
  const r = (k: number) => ((Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
  const q = quoteOf(text);
  // (the cast: the first largest, in front, a little left of middle; the rest round it, smaller, behind)
  const slots = cast.map((e, i) => {
    const flip = e.startsWith("~"), g = flip ? e.slice(1) : e, n2 = cast.length;
    const x = i === 0 ? 150 + r(1) * 30 : 60 + ((i - 1 + 0.5) / Math.max(1, n2 - 1)) * 290 + (r(i + 7) - 0.5) * 24;
    const y = i === 0 ? 200 : 178 - (i % 2) * 12, size = i === 0 ? 66 : 46 - Math.min(10, n2 * 1.5);
    return { g, x: i > 0 && Math.abs(x - 165) < 50 ? x + (x < 165 ? -50 : 50) : x, y, size, flip, i };
  });
  const id = `il${seed}`;
  return <svg className={`bk-ill${lite ? " is-lite" : ""}`} viewBox="0 0 400 220" role="img" aria-label="삽화">
    <defs>
      <linearGradient id={`sk${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={a} /><stop offset="1" stopColor={b} /></linearGradient>
      <radialGradient id={`vg${id}`} cx="0.5" cy="0.45" r="0.75"><stop offset="0.6" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#3b2a14" stopOpacity="0.28" /></radialGradient>
      <clipPath id={`cl${id}`}><rect width="400" height="220" rx="14" /></clipPath>
    </defs>
    <g clipPath={`url(#cl${id})`}>
      <rect width="400" height="220" fill={`url(#sk${id})`} />
      <Backdrop scene={scene} id={id} r={r} />
      {slots.slice().sort((p, q2) => q2.i - p.i).map(s => <g key={s.i} transform={`translate(${s.x} ${s.y})`}>
        <ellipse cx="0" cy="-2" rx={s.size * 0.36} ry="5" fill="#000" opacity="0.18" />
        <g className={s.i === 0 ? "a-bob" : s.i % 2 ? "a-bob2" : "a-bob3"} style={{ animationDelay: `${-r(s.i + 2) * 2}s` }}>
          <text x="0" y="-4" fontSize={s.size} textAnchor="middle" transform={s.flip ? "scale(-1 1)" : undefined}>{s.g}</text>
        </g>
      </g>)}
      {q && slots[0] && <g transform={`translate(${Math.min(300, slots[0].x + 26)} ${Math.max(30, slots[0].y - slots[0].size - 34)})`} className="a-pop">
        <rect x="-6" y="-20" width={q.length * 12.5 + 18} height="30" rx="14" fill="#ffffff" stroke="#3b2a14" strokeWidth="1.5" />
        <path d="M6 10 l-10 12 l18 -12Z" fill="#ffffff" stroke="#3b2a14" strokeWidth="1.5" /><rect x="0" y="6" width="22" height="5" fill="#ffffff" />
        <text x="3" y="0" fontSize="13" fontWeight="700" fill="#2b2118">{q}</text>
      </g>}
      <rect width="400" height="220" fill={`url(#vg${id})`} />
    </g>
  </svg>;
}

function Chart({ c }: { c: PageChart }) {
  const vals = c.bars.map(b => b.value), max = c.max ?? Math.max(...vals.map(Math.abs), c.line?.value ?? 0) * 1.15, neg = Math.min(0, ...vals) < 0;
  const W = 400, H = 190, left = 12, top = 30, ch = 120, base = neg ? top + ch / 2 : top + ch, scale = (neg ? ch / 2 : ch) / max, bw = Math.min(80, (W - 40) / c.bars.length - 20);
  return <svg className="bk-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={c.title}>
    <rect width={W} height={H} rx="12" fill="#ffffff" stroke="#e7dfcf" />
    <text x={W / 2} y="20" textAnchor="middle" fontSize="14" fontWeight="800" fill="#1d2b3a">{c.title}</text>
    <line x1={left + 8} x2={W - 12} y1={base} y2={base} stroke="#9aa5b1" />
    {c.bars.map((b, i) => { const x = 30 + i * ((W - 40) / c.bars.length) + ((W - 40) / c.bars.length - bw) / 2, h = Math.abs(b.value) * scale, y = b.value >= 0 ? base - h : base;
      return <g key={i}><rect x={x} y={y} width={bw} height={Math.max(1, h)} rx="6" fill={b.color ?? "#54a0ff"} /><text x={x + bw / 2} y={b.value >= 0 ? y - 5 : y + h + 14} textAnchor="middle" fontSize="13" fontWeight="800" fill="#1d2b3a">{b.value > 0 && neg ? "+" : ""}{b.value}{c.unit}</text>
        <text x={x + bw / 2} y={H - 10} textAnchor="middle" fontSize="11.5" fill="#44515f">{b.label}</text></g>; })}
    {c.line && <><line x1={left + 8} x2={W - 12} y1={base - c.line.value * scale} y2={base - c.line.value * scale} stroke="#e63946" strokeDasharray="6 4" strokeWidth="2" /><text x={W - 14} y={base - c.line.value * scale - 6} textAnchor="end" fontSize="12" fontWeight="800" fill="#e63946">{c.line.label}</text></>}
  </svg>;
}

// ------------------------------------------------------------------ the faces of the leaves
// (a face drawn once and kept: the turning strips re-use it every frame; drawn without the watercolour filter there)
const FaceView = memo((props: { book: StoryBook; f: Face; lite?: boolean }) => FaceViewRaw(props), (a, b) => a.book === b.book && a.lite === b.lite && a.f.kind === b.f.kind && a.f.n === b.f.n);
type Face = { kind: "cover" | "title" | "page" | "end" | "back" | "blank"; n?: number };
function FaceViewRaw({ book, f, lite }: { book: StoryBook; f: Face; lite?: boolean }) {
  if (f.kind === "cover") return <div className="bk-cover" style={{ background: `linear-gradient(135deg, ${book.color}, ${book.color} 55%, ${book.color2})`, color: book.ink }}>
    <div className="bk-cover-frame"><small>{book.genre}</small><div className="bk-cover-icon">{book.icon}</div><h2>{book.title}</h2><p>{book.by}</p></div></div>;
  if (f.kind === "back") return <div className="bk-cover bk-back" style={{ background: `linear-gradient(225deg, ${book.color}, ${book.color} 60%, ${book.color2})`, color: book.ink }}><p>{book.title}</p><small>이야기숲 출판 · {book.genre}</small><div className="bk-barcode" /></div>;
  if (f.kind === "title") return <div className="bk-paper bk-titlepage"><div className="bk-ti-icon">{book.icon}</div><h3>{book.title}</h3><p>{book.by}</p><small>전체 {book.pages.length}쪽</small></div>;
  if (f.kind === "end") return <div className="bk-paper bk-endpage"><h3>끝</h3><p>『{book.title}』을 끝까지 읽었어요.</p><div className="bk-ti-icon">{book.icon}</div></div>;
  if (f.kind === "blank") return <div className="bk-paper" />;
  const p = asPage(book.pages[f.n!]);
  return <div className="bk-paper bk-page">
    {p.chart ? <Chart c={p.chart} /> : <Illustration text={p.text} icon={book.icon} seed={f.n! + book.id.length * 13} lite={lite} book={book.id} n={f.n!} />}
    {p.heading && <h4>{p.heading}</h4>}
    <p>{p.text}</p>
    <span className="bk-num">{f.n! + 1}</span>
  </div>;
}

/** The leaf being turned, folding as paper does — no facets: the sheet's free edge travels from its
 * outer edge across to the far page; the fold line runs halfway between (tilted by where the corner
 * was taken). The part short of the fold stays flat; past it the sheet is lifted and laid back over,
 * showing its other side — the reflection of the page about the fold. The fold's roll is shaded (a
 * dark crease, a bright lip, the curl's falling light), the flap casts a soft shadow, and the page it
 * uncovers lies in the shadow of the lifted sheet. `a`: 0 (flat, unturned) … 180 (turned). */
function FoldLeaf({ book, front, back, a, tilt, z, W, H }: { book: StoryBook; front: Face; back: Face; a: number; tilt: number; z: number; W: number; H: number }) {
  const p = Math.min(1, Math.max(0, a / 180)), th = tilt * Math.sin(p * Math.PI);           // (straightening as it lands)
  const fold = W * (1 - p), tn = Math.tan(th), xL = (y: number) => fold + (y - H / 2) * tn;     // the fold line, x at height y
  // the reflection about the fold line (direction d) after the page's own mirror (back = front mirrored)
  const dx = Math.sin(th), dy = Math.cos(th), Px = fold, Py = H / 2;
  const refl = (x: number, y: number) => { const wx = x - Px, wy = y - Py, k = 2 * (wx * dx + wy * dy); return [Px + k * dx - wx, Py + k * dy - wy]; };
  const map = (u: number, y: number) => refl(W - u, y);       // back-face point (u, y) → leaf coordinates
  const [e0, f0] = map(0, 0), [a1, b1] = map(1, 0), [c1, d1] = map(0, 1);
  const matrix = `matrix(${a1 - e0}, ${b1 - f0}, ${c1 - e0}, ${d1 - f0}, ${e0}, ${f0})`;
  // the flap's visible part in its own (back-face) coordinates: u < W − xL(y)
  const uTop = Math.max(0, W - xL(0)), uBot = Math.max(0, W - xL(H));
  const flapClip = `polygon(0px 0px, ${uTop}px 0px, ${uBot}px ${H}px, 0px ${H}px)`;
  const frontClip = `polygon(0px 0px, ${Math.max(0, xL(0))}px 0px, ${Math.max(0, xL(H))}px ${H}px, 0px ${H}px)`;
  const lift = Math.sin(p * Math.PI);                                                            // how far off the page it stands
  const ang = 90 + (th * 180) / Math.PI;                                                          // gradient across the fold
  return <div className="bk-leaf bk-folding" style={{ zIndex: z }}>
    {/* the part still lying flat: darkening toward the fold as it starts to rise */}
    <div className="bk-face bk-front" style={{ clipPath: frontClip, WebkitClipPath: frontClip }}>
      <FaceView book={book} f={front} />
      <div className="bk-fshade" style={{ background: `linear-gradient(${ang}deg, rgba(0,0,0,0) ${Math.max(0, (fold / W) * 100 - 14)}%, rgba(40,25,10,${0.22 * lift}) ${(fold / W) * 100}%)` }} />
    </div>
    {/* the page uncovered past the fold, in the lifted sheet's shadow */}
    <div className="bk-ushadow" style={{ clipPath: `polygon(${Math.max(0, xL(0))}px 0px, ${W}px 0px, ${W}px ${H}px, ${Math.max(0, xL(H))}px ${H}px)`, background: `linear-gradient(${ang}deg, rgba(0,0,0,${0.42 * lift}) ${(fold / W) * 100}%, rgba(0,0,0,0) ${Math.min(100, (fold / W) * 100 + 22 + 20 * lift)}%)` }} />
    {/* the flap: the other side, laid back over, its roll shaded; a soft shadow under it */}
    <div className="bk-flapwrap" style={{ filter: `drop-shadow(${-10 * lift}px ${4 * lift}px ${14 * lift + 2}px rgba(0,0,0,${0.35 * lift + 0.05}))` }}>
      <div className="bk-flap" style={{ transform: matrix, clipPath: flapClip, WebkitClipPath: flapClip, width: W, height: H }}>
        <FaceView book={book} f={back} />
        <div className="bk-fshade" style={{ background: `linear-gradient(${180 - ang}deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0) ${Math.max(0, (uTop + uBot) / 2 / W * 100 - 30)}%, rgba(255,255,255,${0.25 * lift}) ${Math.max(0, (uTop + uBot) / 2 / W * 100 - 7)}%, rgba(255,255,255,${0.45 * lift}) ${Math.max(0, (uTop + uBot) / 2 / W * 100 - 2.5)}%, rgba(60,40,15,${0.35 * lift}) ${(uTop + uBot) / 2 / W * 100}%)` }} />
      </div>
    </div>
  </div>;
}

const LAST = (id: string) => { try { return Number(localStorage.getItem(`book.last.${id}`) ?? 0) || 0; } catch { return 0; } };
const SAVE = (id: string, n: number) => { try { localStorage.setItem(`book.last.${id}`, String(n)); } catch { /* private mode */ } };

export function BookReader({ book, onClose }: { book: StoryBook; onClose: () => void }) {
  // leaves: [front (right side), back (left side once turned)]
  const leaves = useMemo(() => {
    const L: [Face, Face][] = [[{ kind: "cover" }, { kind: "title" }]];
    for (let i = 0; i < book.pages.length; i += 2) L.push([{ kind: "page", n: i }, i + 1 < book.pages.length ? { kind: "page", n: i + 1 } : { kind: "blank" }]);
    L.push([{ kind: "end" }, { kind: "back" }]);
    return L;
  }, [book]);
  const N = leaves.length;
  const [turned, setTurned] = useState(0);
  const [anim, setAnim] = useState<{ leaf: number; a: number; dir: 1 | -1; tilt?: number } | null>(null);
  const [size, setSize] = useState({ w: 600, h: 820 });
  const tilt = useRef(-0.14);
  const [big, setBig] = useState(false), [leaving, setLeaving] = useState(false), [resume, setResume] = useState(() => LAST(book.id));
  const raf = useRef(0), drag = useRef<{ leaf: number; x0: number; w: number; dir: 1 | -1; moved: boolean } | null>(null), bookEl = useRef<HTMLDivElement>(null);
  const queue = useRef(0); // leaves still to turn when jumping (positive forward, negative back)
  const busy = useRef(false);
  const close = useCallback(() => { setLeaving(true); setTimeout(onClose, 380); }, [onClose]);
  useEffect(() => { if (turned > 0 && turned < N) SAVE(book.id, turned); }, [turned, book.id, N]);
  const animate = useCallback((leaf: number, from: number, to: number, dir: 1 | -1, speed: number, done: () => void) => {
    cancelAnimationFrame(raf.current); busy.current = true;
    const t0 = performance.now(), dur = (480 + Math.abs(to - from) * 2.6) * speed;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      // (a turn's ease: a quick lift, a long glide, the page settling with a touch of overshoot)
      const e = k < 1 ? 1 - Math.pow(1 - k, 3) : 1;
      setAnim({ leaf, a: from + (to - from) * e, dir, tilt: tilt.current });
      if (k < 1) raf.current = requestAnimationFrame(step); else { busy.current = false; setAnim(null); done(); }
    };
    raf.current = requestAnimationFrame(step);
  }, []);
  const tRef = useRef(0); tRef.current = turned;
  const setT = (v: number) => { tRef.current = v; setTurned(v); };
  const turnForward = useCallback((speed = 1): void => {
    const t = tRef.current; if (busy.current || t >= N) return;
    if (!drag.current) tilt.current = -0.14;
    rustle(t === 0 || t === N - 1);
    animate(t, 0, 180, 1, speed, () => { setT(t + 1); if (queue.current > 0) { queue.current--; setTimeout(() => turnForward(0.45), 30); } });
  }, [N, animate]);
  const turnBack = useCallback((speed = 1): void => {
    const t = tRef.current; if (busy.current || t <= 0) return;
    if (!drag.current) tilt.current = -0.14;
    rustle(t === 1 || t === N); setT(t - 1);
    animate(t - 1, 180, 0, -1, speed, () => { if (queue.current < 0) { queue.current++; setTimeout(() => turnBack(0.45), 30); } });
  }, [N, animate]);
  const jump = (to: number) => { if (busy.current || to === turned) return; const n = to - turned; queue.current = n > 0 ? n - 1 : n + 1; if (n > 0) turnForward(n > 1 ? 0.45 : 1); else turnBack(n < -1 ? 0.45 : 1); setResume(0); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { e.stopPropagation(); if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { e.preventDefault(); turnForward(); } else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); turnBack(); } else if (e.key === "Escape") close(); };
    window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true);
  }, [turnForward, turnBack, close]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  useEffect(() => {
    const el = bookEl.current; if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); setSize({ w: el.offsetWidth / 2, h: el.offsetHeight }); void r; });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  // dragging a corner: the page follows the hand, curling; let go past a third of the way (or with a flick) and it turns
  const last = useRef({ x: 0, t: 0, v: 0 });
  const down = (e: React.PointerEvent) => {
    if (busy.current || !bookEl.current) return;
    const r = bookEl.current.getBoundingClientRect(), right = e.clientX > r.left + r.width / 2;
    if (right && turned < N) drag.current = { leaf: turned, x0: e.clientX, w: r.width / 2, dir: 1, moved: false };
    else if (!right && turned > 0) drag.current = { leaf: turned - 1, x0: e.clientX, w: r.width / 2, dir: -1, moved: false };
    else return;
    last.current = { x: e.clientX, t: performance.now(), v: 0 };
    // (taken by its lower corner the fold leans one way, by the upper the other)
    tilt.current = Math.max(-0.42, Math.min(0.42, -((e.clientY - r.top) / r.height - 0.5) * 0.9));
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const now = performance.now(); last.current = { x: e.clientX, t: now, v: (e.clientX - last.current.x) / Math.max(1, now - last.current.t) };
    if (!d.moved && Math.abs(e.clientX - d.x0) < 6) return;
    if (!d.moved) { d.moved = true; if (d.dir < 0) setT(d.leaf); rustle(); }
    const dx = (e.clientX - d.x0) / (d.w * 1.7), a = d.dir > 0 ? Math.max(0, Math.min(180, -dx * 180)) : Math.max(0, Math.min(180, 180 - dx * 180));
    setAnim({ leaf: d.leaf, a, dir: d.dir, tilt: tilt.current });
  };
  const up = () => {
    const d = drag.current; drag.current = null; if (!d) return;
    if (!d.moved) { if (d.dir > 0) turnForward(); else turnBack(); return; }
    const a = anim?.a ?? (d.dir > 0 ? 0 : 180), flick = last.current.v;   // px/ms, − leftwards
    const go = d.dir > 0 ? (a > 60 || flick < -0.5) : !(a < 120 || flick > 0.5);
    if (go) animate(d.leaf, a, 180, 1, 0.7, () => setT(d.leaf + 1)); else animate(d.leaf, a, 0, -1, 0.7, () => setT(d.leaf));
    setResume(0);
  };
  const shift = turned === 0 && !anim ? "-25%" : turned === N && !anim ? "25%" : "0%";
  const reading = turned > 0 && turned < N ? Math.min(book.pages.length, (turned - 1) * 2 + 2) : 0;
  const leftStack = Math.min(turned, N - 1), rightStack = Math.max(0, N - 1 - turned);
  return <div className={`bk-shade${leaving ? " is-leaving" : ""}${big ? " is-big" : ""}`} role="dialog" aria-label={`『${book.title}』 읽기`} onPointerDown={e => e.stopPropagation()}>
    <div className="bk-top">
      <b>『{book.title}』</b><span>{turned === 0 ? "표지" : turned === N ? "뒤표지" : `${reading} / ${book.pages.length}쪽`}</span>
      <button type="button" className="bk-ghost" onClick={() => setBig(v => !v)} aria-pressed={big}>{big ? "가 작게" : "가 크게"}</button>
      <button type="button" onClick={close}>닫기 · Esc</button>
    </div>
    <div className="bk-progress"><i style={{ width: `${(turned / N) * 100}%` }} /></div>
    <div className="bk-stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div className="bk-book" ref={bookEl} style={{ transform: `translateX(${shift}) rotateX(7deg)` }}>
        <div className="bk-stack bk-stack-l" style={{ opacity: leftStack ? 1 : 0, boxShadow: Array.from({ length: Math.min(8, leftStack + 1) }, (_, i) => `${-2 - i * 1.6}px ${2 + i * 1.2}px 0 ${i % 2 ? "#e6d8bd" : "#f5ecd9"}`).join(",") }} />
        <div className="bk-stack bk-stack-r" style={{ opacity: rightStack ? 1 : 0, boxShadow: Array.from({ length: Math.min(8, rightStack + 1) }, (_, i) => `${2 + i * 1.6}px ${2 + i * 1.2}px 0 ${i % 2 ? "#e6d8bd" : "#f5ecd9"}`).join(",") }} />
        <div className="bk-spine" />
        {leaves.map(([front, back], i) => {
          if (anim?.leaf === i) return <FoldLeaf key={i} book={book} front={front} back={back} a={anim.a} tilt={anim.tilt ?? -0.14} z={N + 2} W={size.w} H={size.h} />;
          const flipped = i < turned, z = flipped ? i + 1 : N - i;
          return <div key={i} className={`bk-leaf${!flipped && i === turned && !anim ? " bk-next" : ""}`} style={{ transform: `rotateY(${flipped ? -180 : 0}deg)`, zIndex: z }}>
            <div className="bk-face bk-front"><FaceView book={book} f={front} /></div>
            <div className="bk-face bk-backface"><FaceView book={book} f={back} /></div>
          </div>;
        })}
        <div className="bk-ribbon" style={{ left: turned > 0 && turned < N ? "calc(50% + 34px)" : "calc(100% - 40px)" }} />
      </div>
    </div>
    <div className="bk-nav">
      <button type="button" onClick={() => turnBack()} disabled={turned === 0}>← 이전</button>
      <div className="bk-dots">{leaves.map((_, i) => <button type="button" key={i} className={i < turned ? "on" : i === turned ? "here" : ""} onClick={() => jump(i)} aria-label={i === 0 ? "표지로" : `${i * 2 - 1}쪽으로`} />)}</div>
      <button type="button" onClick={() => turnForward()} disabled={turned === N}>다음 →</button>
    </div>
    {resume > 1 && turned === 0 && <button type="button" className="bk-resume" onClick={() => jump(resume)}>📑 지난번에 읽던 {Math.min(book.pages.length, (resume - 1) * 2 + 2)}쪽부터 이어 읽기</button>}
    <p className="bk-hint">모서리를 끌어 넘기거나 눌러 넘기세요 · ← → 키 · 아래 점으로 원하는 쪽으로 이동</p>
  </div>;
}

/** the bookshop's shelf of readable books: pick one to read (free to browse in the shop) */
export function BookShelf({ onRead, onClose, owned }: { onRead: (b: StoryBook) => void; onClose: () => void; owned?: Set<string> }) {
  return <div className="bk-shade bk-shelfwrap" role="dialog" aria-label="책 고르기" onPointerDown={e => e.stopPropagation()} onKeyDown={e => { e.stopPropagation(); if (e.key === "Escape") onClose(); }}>
    <div className="bk-top"><b>📚 서가 · 읽고 싶은 책을 골라 보세요</b><span>{STORY_BOOKS.length}권 · 모두 10쪽</span><button type="button" onClick={onClose}>닫기 · Esc</button></div>
    <div className="bk-shelf">{STORY_BOOKS.map(b => <button type="button" key={b.id} onClick={() => onRead(b)} className="bk-spinecard">
      <div className="bk-mini" style={{ background: `linear-gradient(135deg, ${b.color}, ${b.color2})`, color: b.ink }}><i>{b.icon}</i><b>{b.title}</b></div>
      <small>{b.genre}{owned?.has(b.id) ? " · 내 책" : ""}</small></button>)}</div>
  </div>;
}
