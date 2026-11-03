import { GESTURES, GESTURE_LIST, type GestureName } from "./player/gestures";

/* The visitor's gestures: a grid of them (G); one played on the figure and answered by those near. */
const ICON: Record<GestureName, string> = { wave: "👋", bow: "🙇", deepBow: "🙇‍♂️", nod: "🙂", shake: "🙅", clap: "👏", cheer: "🙌", point: "👉", shrug: "🤷", salute: "🫡", think: "🤔", phone: "📞", lookPhone: "📱", watch: "⌚", scratch: "😅", crossArms: "😤", handsHips: "🦸", stretch: "🙆", yawn: "🥱", facepalm: "🤦", laugh: "😂", cry: "😭", angry: "😠", thumbsUp: "👍", heart: "💗", peace: "✌️", dance: "💃", robot: "🤖", groove: "🎶", jump: "🤸", beckon: "🫴", stop: "✋", lookAround: "👀", kick: "🦵", shy: "☺️" };
export default function GesturePanel({ onPick, onClose }: { onPick: (g: GestureName) => void; onClose: () => void }) {
  return (
    <div className="wk-gestures" role="dialog" aria-label="제스처" onPointerDown={e => e.stopPropagation()}>
      <header><b>제스처 · 행동</b><small>{GESTURE_LIST.length}가지 · 가까운 사람들이 반응해요</small><button type="button" onClick={onClose} aria-label="닫기">×</button></header>
      <div className="wk-gesture-grid">{GESTURE_LIST.map(g => <button type="button" key={g} onClick={() => onPick(g)}><i aria-hidden="true">{ICON[g]}</i><span>{GESTURES[g].label}</span></button>)}</div>
    </div>
  );
}
