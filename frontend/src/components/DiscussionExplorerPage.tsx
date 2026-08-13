import { PointerEvent as ReactPointerEvent, WheelEvent, useEffect, useMemo, useRef, useState } from "react";
import { BoardComment, BoardDetail, BoardPost, EtfItem, GlobalDiscussionPost, StockSearchResult, api } from "../api/client";
import { Link } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import StockLogo from "./StockLogo";
import "../discussionExplorer.css";

const INITIAL_COUNT = 50;
const MAX_VISIBLE = 50;
const SPHERE_RADIUS = 510;

const STAR_COLORS = ["#ffffff", "#dff7ff", "#9edcff", "#c7b9ff", "#ffe2a8"];
const cosmicRandom = (seed: number) => {
  const value = Math.sin(seed * 91.733 + 17.17) * 43758.5453;
  return value - Math.floor(value);
};
const COSMIC_STARS = Array.from({ length: 145 }, (_, index) => ({
  x: cosmicRandom(index * 5 + 1) * 100,
  y: cosmicRandom(index * 5 + 2) * 100,
  size: index % 31 === 0 ? 3.5 + cosmicRandom(index + 9) * 2.2 : 0.6 + cosmicRandom(index * 5 + 3) * 1.8,
  opacity: 0.28 + cosmicRandom(index * 5 + 4) * 0.72,
  duration: 2.2 + cosmicRandom(index * 5 + 5) * 5.8,
  delay: -cosmicRandom(index * 7 + 3) * 7,
  color: STAR_COLORS[index % STAR_COLORS.length],
  radiant: index % 31 === 0,
}));

const CARD_THEMES = [
  { accent: "#67e8f9", text: "#ddfbff", a: "rgba(8,72,92,.9)", b: "rgba(8,20,43,.82)" },
  { accent: "#c4b5fd", text: "#f2edff", a: "rgba(72,45,125,.88)", b: "rgba(20,13,52,.84)" },
  { accent: "#f9a8d4", text: "#fff0f7", a: "rgba(118,35,82,.86)", b: "rgba(48,13,41,.84)" },
  { accent: "#86efac", text: "#edfff3", a: "rgba(18,91,65,.88)", b: "rgba(7,41,38,.84)" },
  { accent: "#fde68a", text: "#fff9db", a: "rgba(116,78,16,.88)", b: "rgba(49,31,8,.84)" },
  { accent: "#fdba74", text: "#fff3e8", a: "rgba(133,55,23,.88)", b: "rgba(54,21,11,.84)" },
  { accent: "#93c5fd", text: "#edf6ff", a: "rgba(25,75,135,.88)", b: "rgba(8,29,64,.84)" },
  { accent: "#5eead4", text: "#e5fffb", a: "rgba(14,94,91,.88)", b: "rgba(5,39,46,.84)" },
];

type UniversePost = {
  id: string;
  title: string;
  preview: string;
  author: string;
  date: string;
  views: number;
  likes: number;
  dislikes: number;
  source?: GlobalDiscussionPost;
};

type AssetKind = "STOCK" | "ETF";
type SearchAsset = { code: string; name: string; market: "KR" | "US"; kind: AssetKind };

type Point3D = { x: number; y: number; z: number };

function spherePoint(index: number, count: number, sphereRadius: number): Point3D {
  const y = 1 - (index / Math.max(1, count - 1)) * 2;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = Math.PI * (3 - Math.sqrt(5)) * index;
  return {
    x: Math.cos(theta) * radius * sphereRadius,
    y: y * sphereRadius,
    z: Math.sin(theta) * radius * sphereRadius,
  };
}

function defaultZoom(): number {
  if (window.innerWidth <= 480) return 0.42;
  if (window.innerWidth <= 820) return 0.58;
  return 0.82;
}

function normalizeDomestic(post: BoardPost): UniversePost {
  return {
    id: post.nid,
    title: post.title,
    preview: post.title,
    author: post.author,
    date: post.date,
    views: post.views,
    likes: post.likes,
    dislikes: post.dislikes,
  };
}

function normalizeGlobal(post: GlobalDiscussionPost): UniversePost {
  return {
    id: post.id,
    title: post.title || post.text.slice(0, 70),
    preview: post.text,
    author: post.author,
    date: post.written_at.slice(0, 16).replace("T", " "),
    views: post.views,
    likes: post.likes,
    dislikes: post.dislikes,
    source: post,
  };
}

function dedupe<T extends { id: string }>(items: T[]): T[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

function DetailPanel({
  post,
  code,
  market,
  onClose,
}: {
  post: UniversePost;
  code: string;
  market: "KR" | "US";
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<BoardDetail | null>(null);
  const [comments, setComments] = useState<BoardComment[]>([]);
  const [loading, setLoading] = useState(market === "KR");
  const [error, setError] = useState("");

  useEffect(() => {
    if (market !== "KR") return;
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([api.boardDetail(code, post.id), api.boardComments(code, post.id)])
      .then(([nextDetail, nextComments]) => {
        if (cancelled) return;
        setDetail(nextDetail);
        setComments(nextComments.items);
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message || "게시글을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [code, market, post.id]);

  return (
    <aside className="discussion-detail" aria-label="게시글 상세">
      <div className="discussion-detail-glow" aria-hidden="true" />
      <header>
        <div>
          <span className="discussion-detail-kicker">DISCUSSION SIGNAL</span>
          <h2>{detail?.title || post.title}</h2>
          <p>{detail?.author || post.author} · {detail?.written_at?.slice(0, 16).replace("T", " ") || post.date}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="상세 닫기">×</button>
      </header>

      <div className="discussion-detail-scroll">
        {loading && <div className="discussion-detail-loading"><i /><span>신호를 해독하는 중…</span></div>}
        {error && <div className="discussion-detail-error">{error}</div>}
        {market === "US" && <p className="discussion-detail-text">{post.source?.text || post.preview}</p>}
        {detail?.blocks.map((block, index) =>
          block.type === "image" && block.src ? (
            <img key={`${post.id}-${index}`} src={block.src} alt="게시글 첨부 이미지" loading="lazy" />
          ) : (
            <p key={`${post.id}-${index}`} className="discussion-detail-text">{block.text}</p>
          )
        )}

        {!loading && market === "KR" && (
          <section className="discussion-detail-comments">
            <h3>댓글 <span>{comments.length}</span></h3>
            {comments.length === 0 ? <p className="discussion-detail-empty">아직 댓글이 없습니다.</p> : comments.map((comment) => (
              <article key={comment.id}>
                <div><strong>{comment.author || "익명"}</strong><time>{comment.written_at.slice(0, 16).replace("T", " ")}</time></div>
                <p>{comment.text}</p>
                <span>공감 {comment.likes} · 비공감 {comment.dislikes}</span>
              </article>
            ))}
          </section>
        )}
      </div>
    </aside>
  );
}

export default function DiscussionExplorerPage() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code") || "005930";
  const name = params.get("name") || code;
  const market = params.get("market") === "US" ? "US" : "KR";
  const assetKind: AssetKind = params.get("asset") === "ETF" ? "ETF" : "STOCK";
  const backPath = assetKind === "ETF" ? "/etf" : market === "US" ? `/global?code=${encodeURIComponent(code)}` : `/desk?code=${encodeURIComponent(code)}`;

  useDocumentTitle(`${name} 종목토론탐험 · K-Stock Hub`);
  const [posts, setPosts] = useState<UniversePost[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<UniversePost | null>(null);
  const [disintegrating, setDisintegrating] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [autoRotate, setAutoRotate] = useState(true);
  const [zoomLabel, setZoomLabel] = useState(100);
  const [helpOpen, setHelpOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [stockResults, setStockResults] = useState<StockSearchResult[]>([]);
  const [etfUniverse, setEtfUniverse] = useState<EtfItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const nextDomesticPage = useRef(6);
  const nextGlobalOffset = useRef<string | null>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const starCanvasRef = useRef<HTMLCanvasElement>(null);
  const rotation = useRef({ x: -8, y: 0 });
  const zoom = useRef(defaultZoom());
  const drag = useRef({ active: false, x: 0, y: 0, pointerId: -1 });
  const touchDistance = useRef<number | null>(null);

  useEffect(() => {
    const canvas = starCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let previous = -Infinity;
    let width = 0;
    let height = 0;
    let ratio = 1;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      // A capped DPR keeps stars crisp without allocating a full 4K canvas on
      // high-density phones and tablets.
      ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = (time: number) => {
      context.clearRect(0, 0, width, height);
      COSMIC_STARS.forEach((star, index) => {
        const pulse = reducedMotion ? 0.82 : 0.66 + Math.sin(time / (star.duration * 520) + index * 1.71) * 0.26;
        const x = width * star.x / 100;
        const y = height * star.y / 100;
        const radius = star.size * Math.max(0.7, pulse);
        context.globalAlpha = Math.max(0.16, star.opacity * pulse);
        context.fillStyle = star.color;
        context.beginPath();
        context.arc(x, y, radius / 2, 0, Math.PI * 2);
        context.fill();
        if (star.radiant) {
          const glow = context.createRadialGradient(x, y, 0, x, y, radius * 4.8);
          glow.addColorStop(0, "rgba(255,255,255,.9)");
          glow.addColorStop(.18, star.color);
          glow.addColorStop(1, "rgba(103,232,249,0)");
          context.globalAlpha = star.opacity * .62;
          context.fillStyle = glow;
          context.beginPath();
          context.arc(x, y, radius * 4.8, 0, Math.PI * 2);
          context.fill();
          context.strokeStyle = star.color;
          context.lineWidth = .55;
          context.beginPath();
          context.moveTo(x - radius * 5.5, y); context.lineTo(x + radius * 5.5, y);
          context.moveTo(x, y - radius * 5.5); context.lineTo(x, y + radius * 5.5);
          context.stroke();
        }
      });
      context.globalAlpha = 1;
    };

    const animateStars = (time: number) => {
      // Slow stellar scintillation does not need a 60 Hz repaint. 20 Hz looks
      // continuous while leaving the main thread/GPU budget to the 3D cards.
      if (time - previous >= 50) { draw(time); previous = time; }
      frame = window.requestAnimationFrame(animateStars);
    };
    resize();
    draw(0);
    if (!reducedMotion) frame = window.requestAnimationFrame(animateStars);
    window.addEventListener("resize", resize, { passive: true });
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("resize", resize); };
  }, []);

  const applySceneTransform = () => {
    if (!sceneRef.current) return;
    sceneRef.current.style.transform = `translate3d(-50%, -50%, 0) scale(${zoom.current}) rotateX(${rotation.current.x}deg) rotateY(${rotation.current.y}deg)`;
    sceneRef.current.style.setProperty("--face-x", `${-rotation.current.x}deg`);
    sceneRef.current.style.setProperty("--face-y", `${-rotation.current.y}deg`);
  };

  useEffect(() => {
    Promise.all([api.etfs("KR"), api.etfs("US")])
      .then(([kr, us]) => setEtfUniverse([...kr.items, ...us.items]))
      .catch(() => setEtfUniverse([]));
  }, []);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setStockResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      api.search(query)
        .then(setStockResults)
        .catch(() => setStockResults([]))
        .finally(() => setSearching(false));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const searchResults = useMemo<SearchAsset[]>(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    const etfs: SearchAsset[] = etfUniverse
      .filter((item) => `${item.name} ${item.code} ${item.benchmark}`.toLowerCase().includes(query))
      .map((item) => ({ code: item.code, name: item.name, market: item.region, kind: "ETF" }));
    const stocks: SearchAsset[] = stockResults.map((item) => ({
      code: item.code,
      name: item.name,
      market: item.market === "US" ? "US" : "KR",
      kind: "STOCK",
    }));
    return dedupe([...etfs, ...stocks].map((item) => ({ ...item, id: `${item.kind}:${item.market}:${item.code}` })))
      .slice(0, 12)
      .map(({ id: _id, ...item }) => item);
  }, [etfUniverse, searchQuery, stockResults]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const loadDomestic = async () => {
      const pages = await Promise.all([1, 2, 3, 4, 5].map((page) => api.board(code, page, page === 1)));
      return { items: dedupe(pages.flatMap((page) => page.items.map(normalizeDomestic))).slice(0, INITIAL_COUNT), nextOffset: null };
    };
    const loadCursorDiscussion = async (source: "naver" | "toss") => {
      let offset: string | null = null;
      let items: UniversePost[] = [];
      while (items.length < INITIAL_COUNT) {
        const limit = source === "toss" ? 10 : Math.min(50, INITIAL_COUNT - items.length);
        const result: { items: GlobalDiscussionPost[]; next_offset: string | null } = source === "toss"
          ? await api.tossEtfDiscussion(code, limit, offset)
          : await api.globalDiscussion(code, limit, offset);
        items = dedupe([...items, ...result.items.map(normalizeGlobal)]);
        offset = result.next_offset;
        if (!offset || result.items.length === 0) break;
      }
      return { items: items.slice(0, INITIAL_COUNT), nextOffset: offset };
    };
    const request = market === "KR"
      ? loadDomestic()
      : loadCursorDiscussion(assetKind === "ETF" ? "toss" : "naver");

    request
      .then((result) => {
        if (cancelled) return;
        setPosts(result.items);
        nextGlobalOffset.current = result.nextOffset;
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message || "토론 신호를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [assetKind, code, market]);

  useEffect(() => {
    applySceneTransform();
    let frame = 0;
    let previous = performance.now();
    const animate = (now: number) => {
      const elapsed = Math.min(40, now - previous);
      previous = now;
      if (autoRotate && !drag.current.active && !selected && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        // 0.00525 = the original 0.0035 speed × 1.5. Time-based motion keeps the
        // angular velocity identical on 60/90/120Hz displays and after a busy frame.
        rotation.current.y += elapsed * 0.00525;
        applySceneTransform();
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [autoRotate, selected]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches("input, textarea, select")) return;
      const step = event.shiftKey ? 12 : 5;
      if (["ArrowLeft", "a", "A"].includes(event.key)) rotation.current.y -= step;
      else if (["ArrowRight", "d", "D"].includes(event.key)) rotation.current.y += step;
      else if (["ArrowUp", "w", "W"].includes(event.key)) rotation.current.x -= step;
      else if (["ArrowDown", "s", "S"].includes(event.key)) rotation.current.x += step;
      else if (["+", "="].includes(event.key)) zoom.current = Math.min(1.65, zoom.current + 0.08);
      else if (["-", "_"].includes(event.key)) zoom.current = Math.max(0.42, zoom.current - 0.08);
      else if (event.key === "Escape") {
        const closeButton = document.querySelector<HTMLButtonElement>(".discussion-detail header button");
        if (!closeButton) return;
        closeButton.click();
      }
      else return;
      rotation.current.x = Math.max(-80, Math.min(80, rotation.current.x));
      setZoomLabel(Math.round(zoom.current * 100));
      applySceneTransform();
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const activePosts = useMemo(() => posts.filter((post) => !removed.has(post.id)), [posts, removed]);
  const positions = useMemo(() => {
    const count = Math.max(INITIAL_COUNT, activePosts.length);
    // Keep the complete orbit inside narrow screens. Desktop retains the cinematic
    // 510px radius; phones use a tighter physical sphere plus their smaller zoom.
    const sphereRadius = Math.min(SPHERE_RADIUS, Math.max(280, window.innerWidth * 0.44));
    return new Map(activePosts.map((post, index) => [post.id, spherePoint(index, count, sphereRadius)]));
  }, [activePosts]);

  const selectPost = (post: UniversePost) => {
    if (selected && selected.id !== post.id) {
      const previousId = selected.id;
      setDisintegrating(previousId);
      window.setTimeout(() => {
        setRemoved((current) => new Set(current).add(previousId));
        setDisintegrating((current) => current === previousId ? null : current);
      }, 850);
    }
    setSelected(post);
  };

  const closeSelectedPost = () => {
    if (!selected) return;
    const closingId = selected.id;
    // Closing the panel resumes rotation immediately (selected becomes null), while
    // the card remains in the scene just long enough to complete its dust animation.
    setSelected(null);
    setDisintegrating(closingId);
    window.setTimeout(() => {
      setRemoved((current) => new Set(current).add(closingId));
      setDisintegrating((current) => current === closingId ? null : current);
    }, 850);
  };

  const loadMore = async () => {
    if (loadingMore || removed.size === 0 || activePosts.length >= MAX_VISIBLE) return;
    setLoadingMore(true);
    const wanted = Math.min(removed.size, MAX_VISIBLE - activePosts.length);
    try {
      let incoming: UniversePost[] = [];
      if (market === "KR") {
        while (incoming.length < wanted && nextDomesticPage.current <= 20) {
          const result = await api.board(code, nextDomesticPage.current++);
          incoming = dedupe([...incoming, ...result.items.map(normalizeDomestic)]);
          if (result.items.length === 0) break;
        }
      } else if (nextGlobalOffset.current) {
        let offset: string | null = nextGlobalOffset.current;
        while (incoming.length < wanted && offset) {
          const limit = assetKind === "ETF" ? 10 : Math.min(50, wanted - incoming.length);
          const result: { items: GlobalDiscussionPost[]; next_offset: string | null } = assetKind === "ETF"
            ? await api.tossEtfDiscussion(code, limit, offset)
            : await api.globalDiscussion(code, limit, offset);
          incoming = dedupe([...incoming, ...result.items.map(normalizeGlobal)]);
          offset = result.next_offset;
          if (result.items.length === 0) break;
        }
        nextGlobalOffset.current = offset;
      }
      const existing = new Set(posts.map((post) => post.id));
      const additions = incoming.filter((post) => !existing.has(post.id)).slice(0, wanted);
      setPosts((current) => [...current, ...additions]);
    } finally {
      setLoadingMore(false);
    }
  };

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button, a, .discussion-detail")) return;
    drag.current = { active: true, x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const captureCardPress = (event: ReactPointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest(".discussion-detail-layer, .discussion-search, .discussion-controls, .discussion-footer, .discussion-hud")) return;
    const buttons = Array.from(sceneRef.current?.querySelectorAll<HTMLButtonElement>(".discussion-node > button") ?? []);
    const matches = buttons.filter((button) => {
      const rect = button.getBoundingClientRect();
      return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    });
    if (matches.length === 0) return;
    // Several cards can overlap in the projected sphere. Prefer the one the browser
    // paints foremost, then the one whose visual centre is closest to the pointer.
    const chosen = matches.sort((left, right) => {
      const leftNode = left.closest<HTMLElement>(".discussion-node");
      const rightNode = right.closest<HTMLElement>(".discussion-node");
      const depthDifference = Number(rightNode?.style.zIndex || 0) - Number(leftNode?.style.zIndex || 0);
      if (depthDifference) return depthDifference;
      const a = left.getBoundingClientRect();
      const b = right.getBoundingClientRect();
      return Math.hypot(event.clientX - (a.left + a.width / 2), event.clientY - (a.top + a.height / 2))
        - Math.hypot(event.clientX - (b.left + b.width / 2), event.clientY - (b.top + b.height / 2));
    })[0];
    const postId = chosen.dataset.postId;
    const post = activePosts.find((item) => item.id === postId);
    if (!post) return;
    event.preventDefault();
    event.stopPropagation();
    selectPost(post);
  };

  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current.active || drag.current.pointerId !== event.pointerId) return;
    rotation.current.y += (event.clientX - drag.current.x) * 0.24;
    rotation.current.x -= (event.clientY - drag.current.y) * 0.18;
    rotation.current.x = Math.max(-80, Math.min(80, rotation.current.x));
    drag.current.x = event.clientX;
    drag.current.y = event.clientY;
    applySceneTransform();
  };

  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    drag.current.active = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    zoom.current = Math.max(0.42, Math.min(1.65, zoom.current - event.deltaY * 0.0007));
    setZoomLabel(Math.round(zoom.current * 100));
    applySceneTransform();
  };

  const onTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2) {
      touchDistance.current = null;
      return;
    }
    const [a, b] = Array.from(event.touches);
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (touchDistance.current !== null) {
      zoom.current = Math.max(0.42, Math.min(1.65, zoom.current + (distance - touchDistance.current) * 0.003));
      setZoomLabel(Math.round(zoom.current * 100));
      applySceneTransform();
    }
    touchDistance.current = distance;
  };

  return (
    <main
      className={`discussion-explorer ${selected ? "has-detail" : ""}`}
      ref={stageRef}
      onPointerDownCapture={captureCardPress}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onWheel={onWheel}
      onTouchMove={onTouchMove}
      onTouchEnd={() => { touchDistance.current = null; }}
    >
      <div className="discussion-cosmos" aria-hidden="true" />
      <div className="discussion-nebula" aria-hidden="true" />
      <canvas className="discussion-stars" ref={starCanvasRef} aria-hidden="true" />
      <div className="discussion-comets" aria-hidden="true"><i /><i /><i /></div>

      <header className="discussion-hud">
        <Link to={backPath} className="discussion-back" aria-label="종목 상세로 돌아가기">←</Link>
        <div className="discussion-heading">
          <span>LIVE DISCUSSION UNIVERSE</span>
          <h1><StockLogo code={code} className="discussion-heading-logo" />{name} <b>{code}</b></h1>
          <p>종목토론탐험</p>
        </div>
        <div className="discussion-counter"><strong>{activePosts.length}</strong><span>ACTIVE SIGNALS</span></div>
      </header>

      <div className="discussion-search" onPointerDown={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="discussion-search-prompt"
          onClick={() => { searchInputRef.current?.focus(); setSearchOpen(true); }}
        >
          <span aria-hidden="true">✦</span> 삼성전자 외 다른 종목도 탐험해 보세요
        </button>
        <div className={`discussion-search-box ${searchOpen ? "is-open" : ""}`}>
          <span aria-hidden="true">⌕</span>
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => { setSearchQuery(event.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            placeholder="종목명·티커를 입력하세요 (예: SK하이닉스, AAPL, QQQ)"
            aria-label="국내 해외 종목 및 ETF 통합 검색"
          />
          {searching && <i aria-label="검색 중" />}
          {searchQuery && <button type="button" onClick={() => { setSearchQuery(""); setSearchOpen(false); }} aria-label="검색어 지우기">×</button>}
          {!searchQuery && !searching && <button type="button" className="discussion-search-cta" onClick={() => searchInputRef.current?.focus()}>종목 찾기</button>}
        </div>
        {searchOpen && searchQuery.trim() && (
          <div className="discussion-search-results">
            {searchResults.length === 0 && !searching ? <p>검색 결과가 없습니다.</p> : searchResults.map((item) => (
              <button
                type="button"
                key={`${item.kind}-${item.market}-${item.code}`}
                onClick={() => {
                  window.location.assign(`/discussion-explorer?code=${encodeURIComponent(item.code)}&name=${encodeURIComponent(item.name)}&market=${item.market}&asset=${item.kind}`);
                }}
              >
                <span className={`asset-${item.kind.toLowerCase()}`}>{item.kind}</span>
                <strong>{item.name}</strong>
                <small>{item.code}</small>
                <em>{item.market === "KR" ? "국내" : "해외"}</em>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="discussion-statusbar">
        <span><i className="is-live" /> 실시간 토론 궤도</span>
        <span>확대 {zoomLabel}%</span>
        <span>현재 {activePosts.length}/{MAX_VISIBLE}</span>
      </div>

      <section className="discussion-viewport" aria-label={`${name} 최근 종목 토론 3차원 공간`}>
        {loading && <div className="discussion-loading"><div className="discussion-loader-orbit"><i /><i /><i /></div><p>토론 유니버스를 생성하는 중…</p></div>}
        {error && <div className="discussion-error"><strong>연결 신호가 약합니다</strong><span>{error}</span></div>}
        {!loading && !error && activePosts.length === 0 && <div className="discussion-error"><strong>표시할 토론이 없습니다</strong></div>}

        <div className="discussion-scene" ref={sceneRef}>
          <div className="discussion-core" aria-hidden="true"><i /><span>{code}</span></div>
          {activePosts.map((post, index) => {
            const point = positions.get(post.id) || { x: 0, y: 0, z: 0 };
            const renderedRadius = Math.min(SPHERE_RADIUS, Math.max(280, window.innerWidth * 0.44));
            const depth = (point.z + renderedRadius) / (renderedRadius * 2);
            const theme = CARD_THEMES[index % CARD_THEMES.length];
            const viewTone = post.views >= 50 ? "is-hot-view" : post.views >= 15 ? "is-high-view" : post.views < 10 ? "is-low-view" : "is-mid-view";
            return (
              <div
                className={`discussion-node ${viewTone} ${selected?.id === post.id ? "is-selected" : ""} ${disintegrating === post.id ? "is-disintegrating" : ""}`}
                key={post.id}
                style={{
                  // Keep the position in the rotating globe, but counter-rotate the
                  // node itself so its card remains a camera-facing billboard even
                  // around the 90deg side-on point. Keeping this outside the card's
                  // float animation prevents that animation from overriding it.
                  transform: `translate3d(${point.x}px, ${point.y}px, ${point.z}px) rotateY(var(--face-y, 0deg)) rotateX(var(--face-x, 0deg))`,
                  zIndex: Math.round(depth * 100),
                  // Rear-hemisphere posts must remain readable while the sphere turns.
                  // Depth is still communicated by scale and contrast, not by fading
                  // a card until it effectively disappears.
                  opacity: 0.72 + depth * 0.28,
                  "--float-delay": `${-(index % 17) * 0.37}s`,
                  "--node-scale": `${0.68 + depth * 0.5}`,
                  // A bounded micro-orbit gives every signal its own direction without
                  // destroying the globe's spatial memory or letting 80 hit targets
                  // cross one another. Prime-ish cycles avoid visible synchronization.
                  "--drift-x": `${((index * 7) % 11) - 5}px`,
                  "--drift-y": `${((index * 13) % 9) - 4}px`,
                  "--drift-x-start": `${-(((index * 7) % 11) - 5) * 0.55}px`,
                  "--drift-y-start": `${-(((index * 13) % 9) - 4) * 0.55}px`,
                  "--drift-x-mid": `${-(((index * 7) % 11) - 5) * 0.2}px`,
                  "--drift-y-mid": `${(((index * 13) % 9) - 4) * 0.4}px`,
                  "--drift-r": `${((index * 5) % 7) - 3}deg`,
                  "--drift-r-start": `${-(((index * 5) % 7) - 3) * 0.35}deg`,
                  "--drift-r-mid": `${-(((index * 5) % 7) - 3) * 0.15}deg`,
                  "--drift-duration": `${6.5 + (index % 9) * 0.43}s`,
                  "--drift-direction": index % 2 === 0 ? "normal" : "reverse",
                  "--card-accent": theme.accent,
                  "--card-text": theme.text,
                  "--card-a": theme.a,
                  "--card-b": theme.b,
                } as React.CSSProperties}
              >
                <button
                  type="button"
                  data-post-id={post.id}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    // The sphere and each card keep moving between press and release.
                    // Select on press, before browser hit-testing can cancel the click
                    // because the transformed target moved away from the pointer.
                    selectPost(post);
                  }}
                  onPointerUp={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    // Pointer interaction is handled on pointerdown; detail===0 keeps
                    // Enter/Space keyboard activation available without double firing.
                    if (event.detail === 0) selectPost(post);
                  }}
                >
                  <span className="discussion-node-index">{String(index + 1).padStart(2, "0")}</span>
                  <strong>{post.title}</strong>
                  <span className="discussion-node-preview">{post.preview}</span>
                  <span className="discussion-node-meta">{post.author} · 조회 {post.views.toLocaleString()}</span>
                  <i className="discussion-node-beacon" aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <div className="discussion-controls">
        <button type="button" className={autoRotate ? "is-on" : ""} onClick={() => setAutoRotate((value) => !value)} title="자동 회전">◉<span>자동 회전</span></button>
        <button type="button" onClick={() => { zoom.current = Math.min(1.65, zoom.current + 0.12); setZoomLabel(Math.round(zoom.current * 100)); applySceneTransform(); }} title="확대">＋<span>확대</span></button>
        <button type="button" onClick={() => { zoom.current = Math.max(0.42, zoom.current - 0.12); setZoomLabel(Math.round(zoom.current * 100)); applySceneTransform(); }} title="축소">−<span>축소</span></button>
        <button type="button" onClick={() => { const nextZoom = defaultZoom(); rotation.current = { x: -8, y: 0 }; zoom.current = nextZoom; setZoomLabel(Math.round(nextZoom * 100)); applySceneTransform(); }} title="시점 초기화">⌖<span>초기화</span></button>
        <button type="button" onClick={() => setHelpOpen((value) => !value)} title="조작 도움말">?<span>조작법</span></button>
      </div>

      {helpOpen && <div className="discussion-help"><strong>UNIVERSE CONTROLS</strong><span>드래그 · 방향키/WASD — 회전</span><span>휠 · 두 손가락 · +/− — 확대/축소</span><span>게시글 선택 — 본문과 댓글 해독</span></div>}

      <footer className="discussion-footer">
        <div><span>읽은 신호</span><strong>{removed.size}</strong></div>
        <button type="button" onClick={loadMore} disabled={loadingMore || removed.size === 0 || activePosts.length >= MAX_VISIBLE}>
          {loadingMore ? "신호 수신 중…" : removed.size === 0 ? "글을 탐험하면 새 신호를 보충할 수 있습니다" : `사라진 신호 ${Math.min(removed.size, MAX_VISIBLE - activePosts.length)}개 채우기`}
        </button>
      </footer>

      {selected && (
        <div className="discussion-detail-layer" onPointerDown={(event) => event.stopPropagation()}>
          <DetailPanel key={selected.id} post={selected} code={code} market={market} onClose={closeSelectedPost} />
        </div>
      )}
    </main>
  );
}
