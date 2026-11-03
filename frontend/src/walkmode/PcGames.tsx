import { useEffect, useRef, useState } from "react";
import { homography } from "./ScreenApps";
import { wallet, won } from "./game/wallet";

/* A PC방 computer, used as one is: its desktop on the monitor (the camera zoomed in on it), four
 * games of well-known kinds made here — a brick breaker, a snake, a Korean typing game and a space
 * defence — played with the keyboard (and the mouse for the bricks). Best scores kept in this
 * browser; a good game earns a little play money. */

type GameId = "bricks" | "snake" | "typing" | "space";
const GAMES: { id: GameId; name: string; icon: string; how: string }[] = [
  { id: "bricks", name: "벽돌깨기", icon: "🧱", how: "← → 또는 마우스로 받침대 이동 · 스페이스로 시작" },
  { id: "snake", name: "꼬마 뱀", icon: "🐍", how: "방향키로 이동 · 먹이를 먹고 길어지세요" },
  { id: "typing", name: "한글 타자왕", icon: "⌨️", how: "떨어지는 낱말을 입력하고 Enter" },
  { id: "space", name: "우주 방어", icon: "🚀", how: "← → 이동 · 스페이스 발사" },
];
const W = 1200, H = 695;
const best = (g: GameId) => { try { return Number(localStorage.getItem(`pc.best.${g}`) ?? 0) || 0; } catch { return 0; } };
const setBest = (g: GameId, v: number) => { try { localStorage.setItem(`pc.best.${g}`, String(v)); } catch { /* private mode */ } };

let actx: AudioContext | null = null;
function beep(f: number, d = 0.06, type: OscillatorType = "square", g = 0.05) {
  try {
    actx ??= new AudioContext(); const c = actx, o = c.createOscillator(), v = c.createGain();
    o.type = type; o.frequency.value = f; v.gain.setValueAtTime(g, c.currentTime); v.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + d);
    o.connect(v); v.connect(c.destination); o.start(); o.stop(c.currentTime + d + 0.02);
  } catch { /* no audio */ }
}

export default function PcGames({ corners, onClose, onZoom }: { corners(): { x: number; y: number }[] | null; onClose(): void; onZoom(on: boolean): void }) {
  const box = useRef<HTMLDivElement>(null);
  const [game, setGame] = useState<GameId | null>(null);
  const [zoom, setZoom] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setClock(new Date()), 15000); return () => clearInterval(t); }, []);
  useEffect(() => {
    let raf = 0;
    const tick = () => { raf = requestAnimationFrame(tick); const c = corners(), el = box.current; if (!el) return; el.style.visibility = c ? "visible" : "hidden"; if (c) el.style.transform = homography(W, H, c); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [corners]);
  const done = (g: GameId, score: number) => {
    const b = best(g), reward = Math.min(3000, Math.floor(score / 10) * 100);
    if (score > b) setBest(g, score);
    if (reward > 0) wallet.earn(reward);
    setMsg(`${GAMES.find(x => x.id === g)!.name} 점수 ${score}${score > b ? " · 최고 기록!" : ""}${reward ? ` · 게임 머니 ${won(reward)} 획득` : ""}`);
    setGame(null);
  };
  return <>
    <div className="wk-pc" ref={box} style={{ width: W, height: H, visibility: "hidden" }} onPointerDown={e => e.stopPropagation()} onKeyDown={e => { if (e.key !== "Escape") e.stopPropagation(); }}>
      {game ? <GameView id={game} onDone={s => done(game, s)} onQuit={() => setGame(null)} /> : (
        <div className="wk-pc-desk">
          <div className="wk-pc-wall"><b>PC ZONE</b><span>오늘도 즐거운 게임 한 판!</span></div>
          <div className="wk-pc-icons">{GAMES.map(g => <button key={g.id} type="button" onDoubleClick={() => setGame(g.id)} onClick={() => setGame(g.id)}><i>{g.icon}</i><span>{g.name}</span><small>최고 {best(g.id)}</small></button>)}</div>
          {msg && <div className="wk-pc-toast">{msg}</div>}
          <div className="wk-pc-bar"><span className="wk-pc-start">⊞ 시작</span>{GAMES.map(g => <span key={g.id}>{g.icon}</span>)}<span className="wk-pc-clock">{clock.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span></div>
        </div>
      )}
    </div>
    <div className="wk-browser-controls wk-pc-controls" role="dialog" aria-label="PC" onPointerDown={e => e.stopPropagation()}>
      <form onSubmit={e => e.preventDefault()}>
        {game && <button className="wk-btn" type="button" onClick={() => setGame(null)}>게임 나가기</button>}
        <button className="wk-btn" type="button" onClick={() => { onZoom(!zoom); setZoom(!zoom); }}>{zoom ? "축소" : "확대"}</button>
        <button className="wk-btn" type="button" onClick={onClose}>PC 끄기 · Esc</button>
      </form>
      <div className="wk-browser-status">{game ? GAMES.find(g => g.id === game)!.how : "아이콘을 눌러 게임을 시작하세요 · 점수에 따라 게임 머니를 받아요"}</div>
    </div>
  </>;
}

function GameView({ id, onDone, onQuit }: { id: GameId; onDone(score: number): void; onQuit(): void }) {
  const cv = useRef<HTMLCanvasElement>(null), input = useRef<HTMLInputElement>(null);
  const [score, setScore] = useState(0);
  const typed = useRef<string | null>(null);
  // (the callbacks held, so a score's re-render never restarts the game)
  const cb = useRef({ onDone, onQuit }); cb.current = { onDone, onQuit };
  useEffect(() => {
    const c = cv.current!, g = c.getContext("2d")!, keys = new Set<string>();
    let raf = 0, last = performance.now(), sc = 0, over = false, started = id !== "bricks", mouseX: number | null = null;
    const add = (n: number) => { sc += n; setScore(sc); };
    const finish = () => { if (over) return; over = true; beep(220, 0.4, "sawtooth", 0.06); setTimeout(() => cb.current.onDone(sc), 900); };
    const kd = (e: KeyboardEvent) => { if (id === "typing") return; if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(e.key)) e.preventDefault(); keys.add(e.key); if (e.key === " ") started = true; if (e.key === "Escape") cb.current.onQuit(); };
    const ku = (e: KeyboardEvent) => keys.delete(e.key);
    const mm = (e: PointerEvent) => { mouseX = e.offsetX; };
    c.addEventListener("keydown", kd); c.addEventListener("keyup", ku); c.addEventListener("pointermove", mm);
    c.focus();
    const bg = (top: string, bottom: string) => { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, top); gr.addColorStop(1, bottom); g.fillStyle = gr; g.fillRect(0, 0, W, H); };
    const text = (t: string, x: number, y: number, size = 28, col = "#ffffff", align: CanvasTextAlign = "center") => { g.font = `800 ${size}px Pretendard, "Noto Sans KR", sans-serif`; g.textAlign = align; g.fillStyle = col; g.fillText(t, x, y); };
    let step: (dt: number) => void;
    if (id === "bricks") {
      const cols = 12, rows = 6, bw = W / cols, bh = 30, bricks = Array.from({ length: cols * rows }, (_, i) => ({ x: (i % cols) * bw, y: 70 + Math.floor(i / cols) * bh, alive: true, c: ["#ff5d73", "#ff9f43", "#feca57", "#1dd1a1", "#54a0ff", "#a29bfe"][Math.floor(i / cols)] }));
      let px = W / 2, bx = W / 2, by = H - 80, vx = 260, vy = -360, lives = 3;
      step = dt => {
        if (keys.has("ArrowLeft")) px -= 700 * dt; if (keys.has("ArrowRight")) px += 700 * dt; if (mouseX !== null) px = mouseX;
        px = Math.max(70, Math.min(W - 70, px));
        if (!started) { bx = px; by = H - 62; } else if (!over) {
          bx += vx * dt; by += vy * dt;
          if (bx < 10 || bx > W - 10) { vx = -vx; bx = Math.max(10, Math.min(W - 10, bx)); beep(660); }
          if (by < 10) { vy = Math.abs(vy); beep(660); }
          if (by > H - 60 && by < H - 40 && Math.abs(bx - px) < 75 && vy > 0) { vy = -Math.abs(vy) * 1.02; vx = (bx - px) * 6; beep(440); }
          for (const b of bricks) if (b.alive && bx > b.x && bx < b.x + bw && by > b.y && by < b.y + bh) { b.alive = false; vy = -vy; add(10); beep(880 + Math.random() * 200, 0.05, "triangle"); break; }
          if (by > H) { lives--; started = false; if (lives <= 0) finish(); }
          if (bricks.every(b => !b.alive)) { add(200); finish(); }
        }
        bg("#141a33", "#2b1f4f");
        for (const b of bricks) if (b.alive) { g.fillStyle = b.c; g.beginPath(); g.roundRect(b.x + 3, b.y + 3, bw - 6, bh - 6, 6); g.fill(); g.fillStyle = "rgba(255,255,255,.25)"; g.fillRect(b.x + 6, b.y + 5, bw - 12, 5); }
        g.fillStyle = "#e8f6ff"; g.beginPath(); g.roundRect(px - 70, H - 50, 140, 16, 8); g.fill();
        g.fillStyle = "#ffffff"; g.beginPath(); g.arc(bx, by, 10, 0, Math.PI * 2); g.fill();
        text(`점수 ${sc}`, 20, 40, 26, "#ffffff", "left"); text(`♥ ${lives}`, W - 20, 40, 26, "#ff8fa3", "right");
        if (!started && !over) text("스페이스를 눌러 시작", W / 2, H / 2 + 60, 30, "#feca57");
      };
    } else if (id === "snake") {
      const C = 25, cw = Math.floor(W / C), ch = Math.floor((H - 40) / C);
      let snake = [[10, 10], [9, 10], [8, 10]], dir = [1, 0], next = [1, 0], food = [20, 12], acc = 0, speed = 0.11;
      const place = () => { do { food = [Math.floor(Math.random() * cw), Math.floor(Math.random() * ch)]; } while (snake.some(s => s[0] === food[0] && s[1] === food[1])); };
      step = dt => {
        if (keys.has("ArrowLeft") && dir[0] === 0) next = [-1, 0]; if (keys.has("ArrowRight") && dir[0] === 0) next = [1, 0];
        if (keys.has("ArrowUp") && dir[1] === 0) next = [0, -1]; if (keys.has("ArrowDown") && dir[1] === 0) next = [0, 1];
        acc += dt;
        if (!over && acc > speed) {
          acc = 0; dir = next; const h = [snake[0][0] + dir[0], snake[0][1] + dir[1]];
          if (h[0] < 0 || h[1] < 0 || h[0] >= cw || h[1] >= ch || snake.some(s => s[0] === h[0] && s[1] === h[1])) finish();
          else { snake.unshift(h); if (h[0] === food[0] && h[1] === food[1]) { add(10); beep(990, 0.07, "triangle"); place(); speed = Math.max(0.05, speed * 0.97); } else snake.pop(); }
        }
        bg("#0e2a1f", "#123d2c");
        for (let x = 0; x < cw; x++) for (let y = 0; y < ch; y++) if ((x + y) % 2) { g.fillStyle = "rgba(255,255,255,.03)"; g.fillRect(x * C, 40 + y * C, C, C); }
        g.fillStyle = "#ff6b6b"; g.beginPath(); g.arc(food[0] * C + C / 2, 40 + food[1] * C + C / 2, C / 2.4, 0, Math.PI * 2); g.fill();
        snake.forEach((s, i) => { g.fillStyle = i === 0 ? "#b8f2a0" : `hsl(${110 + i * 2}, 60%, ${55 - Math.min(20, i)}%)`; g.beginPath(); g.roundRect(s[0] * C + 2, 40 + s[1] * C + 2, C - 4, C - 4, 6); g.fill(); });
        text(`점수 ${sc}`, 20, 30, 24, "#ffffff", "left");
      };
    } else if (id === "typing") {
      const WORDS = ["사과", "바다", "하늘", "구름", "나무", "기차", "학교", "친구", "음악", "여행", "커피", "바람", "고양이", "강아지", "도서관", "자전거", "무지개", "눈사람", "해바라기", "주식시장", "아파트", "백화점", "한강", "서울", "부산", "제주도", "김밥", "떡볶이", "비빔밥", "편의점", "컴퓨터", "키보드", "모니터", "게임", "우주선", "별빛", "달빛", "행복", "사랑", "희망"];
      const falling: { w: string; x: number; y: number; v: number }[] = []; let spawn = 0, miss = 0, t = 0;
      input.current?.focus();
      step = dt => {
        t += dt; spawn -= dt;
        if (!over && spawn <= 0) { falling.push({ w: WORDS[Math.floor(Math.random() * WORDS.length)], x: 120 + Math.random() * (W - 240), y: 30, v: 40 + Math.min(80, t * 1.2) + Math.random() * 20 }); spawn = Math.max(0.9, 2.4 - t * 0.02); }
        const got = typed.current; typed.current = null;
        if (got !== null) { const i = falling.findIndex(f => f.w === got.trim()); if (i >= 0) { add(falling[i].w.length * 10); falling.splice(i, 1); beep(1046, 0.08, "triangle"); } else beep(200, 0.08); }
        for (const f of falling) f.y += f.v * dt;
        for (let i = falling.length - 1; i >= 0; i--) if (falling[i].y > H - 70) { falling.splice(i, 1); miss++; beep(160, 0.15, "sawtooth"); if (miss >= 5) finish(); }
        bg("#1b2140", "#3a2f63");
        for (const f of falling) { g.font = `800 34px Pretendard, "Noto Sans KR", sans-serif`; const w = g.measureText(f.w).width; g.fillStyle = "rgba(255,255,255,.12)"; g.beginPath(); g.roundRect(f.x - w / 2 - 14, f.y - 30, w + 28, 46, 12); g.fill(); text(f.w, f.x, f.y + 4, 34, "#fff7d6"); }
        g.fillStyle = "rgba(255,90,110,.35)"; g.fillRect(0, H - 70, W, 4);
        text(`점수 ${sc}`, 20, 40, 26, "#ffffff", "left"); text(`놓친 낱말 ${miss}/5`, W - 20, 40, 26, "#ff8fa3", "right");
      };
    } else {
      let x = W / 2, cool = 0, spawn = 0, t = 0, hp = 3;
      const shots: { x: number; y: number }[] = [], foes: { x: number; y: number; v: number; r: number }[] = [], stars = Array.from({ length: 90 }, () => ({ x: Math.random() * W, y: Math.random() * H, s: Math.random() * 2 + 0.5 }));
      step = dt => {
        t += dt; cool -= dt; spawn -= dt;
        if (keys.has("ArrowLeft")) x -= 520 * dt; if (keys.has("ArrowRight")) x += 520 * dt; x = Math.max(40, Math.min(W - 40, x));
        if (keys.has(" ") && cool <= 0 && !over) { shots.push({ x, y: H - 90 }); cool = 0.22; beep(1200, 0.04, "square", 0.03); }
        if (spawn <= 0 && !over) { foes.push({ x: 40 + Math.random() * (W - 80), y: -30, v: 70 + Math.random() * 60 + t * 2, r: 18 + Math.random() * 14 }); spawn = Math.max(0.35, 1.2 - t * 0.01); }
        for (const s of shots) s.y -= 700 * dt; for (const f of foes) f.y += f.v * dt;
        for (let i = foes.length - 1; i >= 0; i--) {
          const f = foes[i], hit = shots.findIndex(s => Math.hypot(s.x - f.x, s.y - f.y) < f.r + 6);
          if (hit >= 0) { shots.splice(hit, 1); foes.splice(i, 1); add(15); beep(300 + Math.random() * 100, 0.12, "sawtooth", 0.05); continue; }
          if (f.y > H - 80 && Math.abs(f.x - x) < f.r + 30) { foes.splice(i, 1); hp--; beep(120, 0.3, "sawtooth"); if (hp <= 0) finish(); continue; }
          if (f.y > H + 40) foes.splice(i, 1);
        }
        bg("#050816", "#14102c");
        for (const s of stars) { s.y += s.s * 40 * dt; if (s.y > H) s.y = 0; g.fillStyle = `rgba(255,255,255,${0.3 + s.s / 3})`; g.fillRect(s.x, s.y, s.s, s.s); }
        g.fillStyle = "#7ef9ff"; for (const s of shots) g.fillRect(s.x - 2, s.y - 12, 4, 14);
        for (const f of foes) { g.fillStyle = "#ff7b54"; g.beginPath(); g.arc(f.x, f.y, f.r, 0, Math.PI * 2); g.fill(); g.fillStyle = "rgba(0,0,0,.25)"; g.beginPath(); g.arc(f.x - f.r * 0.3, f.y - f.r * 0.2, f.r * 0.3, 0, Math.PI * 2); g.fill(); }
        g.fillStyle = "#dfe7ff"; g.beginPath(); g.moveTo(x, H - 110); g.lineTo(x + 28, H - 60); g.lineTo(x - 28, H - 60); g.closePath(); g.fill(); g.fillStyle = "#ff9f43"; g.fillRect(x - 6, H - 60, 12, 10 + Math.random() * 8);
        text(`점수 ${sc}`, 20, 40, 26, "#ffffff", "left"); text("♥".repeat(Math.max(0, hp)), W - 20, 40, 26, "#ff8fa3", "right");
      };
    }
    const loop = (now: number) => { raf = requestAnimationFrame(loop); const dt = Math.min(0.05, (now - last) / 1000); last = now; step(dt); if (over) { g.fillStyle = "rgba(0,0,0,.45)"; g.fillRect(0, 0, W, H); text("게임 끝!", W / 2, H / 2, 64, "#ffffff"); text(`점수 ${sc}`, W / 2, H / 2 + 60, 34, "#feca57"); } };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); c.removeEventListener("keydown", kd); c.removeEventListener("keyup", ku); c.removeEventListener("pointermove", mm); };
  }, [id]);
  return <div className="wk-pc-game">
    <canvas ref={cv} width={W} height={H} tabIndex={0} aria-label={`${id} 게임 화면 · 점수 ${score}`} />
    {id === "typing" && <form className="wk-pc-type" onSubmit={e => { e.preventDefault(); const v = input.current!.value; typed.current = v; input.current!.value = ""; }}><input ref={input} placeholder="낱말을 입력하고 Enter" autoFocus /></form>}
  </div>;
}
