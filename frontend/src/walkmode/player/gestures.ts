/* Gestures and actions a figure plays over its pose (avatar.ts): a wave, a bow, a nod, clapping,
 * cheering, pointing the way, a shrug, a salute, thinking with a hand to the chin, a call on the
 * phone, dances… Each is a few joint angles as functions of time, eased in and out; the legs are
 * left alone when seated. Conventions (avatar joints): shoulder x − forward/up, z out (left −,
 * right +); elbow x − bends; spine x + leans forward; neck x + looks down, y turns; hip x − forward;
 * knee x + bends. */

export type GestureName =
  | "wave" | "bow" | "deepBow" | "nod" | "shake" | "clap" | "cheer" | "point" | "shrug" | "salute" | "think" | "phone" | "lookPhone"
  | "watch" | "scratch" | "crossArms" | "handsHips" | "stretch" | "yawn" | "facepalm" | "laugh" | "cry" | "angry" | "thumbsUp"
  | "heart" | "peace" | "dance" | "robot" | "groove" | "jump" | "beckon" | "stop" | "lookAround" | "kick" | "shy";
type Rot = [number, number, number];
export interface GestureDef { label: string; dur: number; loop?: boolean; legs?: boolean; at(t: number): { j: Record<string, Rot>; lift?: number } }

const S = Math.sin, bell = (t: number, d: number) => Math.sin(Math.min(1, Math.max(0, t / d)) * Math.PI);
const R = (x = 0, y = 0, z = 0): Rot => [x, y, z];
export const GESTURES: Record<GestureName, GestureDef> = {
  wave: { label: "손 흔들기", dur: 2.2, at: t => ({ j: { rShoulder: R(-0.25, 0, 2.55 + 0.28 * S(t * 11)), rElbow: R(-0.35), neck: R(-0.05, 0.1) } }) },
  bow: { label: "인사", dur: 1.6, at: t => ({ j: { spine: R(0.55 * bell(t, 1.6)), neck: R(0.25 * bell(t, 1.6)), lShoulder: R(0.1, 0, -0.05), rShoulder: R(0.1, 0, 0.05) } }) },
  deepBow: { label: "90도 인사", dur: 2.2, at: t => ({ j: { spine: R(1.15 * bell(t, 2.2)), neck: R(0.2 * bell(t, 2.2)), lShoulder: R(0.25, 0, -0.04), rShoulder: R(0.25, 0, 0.04) } }) },
  nod: { label: "끄덕끄덕", dur: 1.3, at: t => ({ j: { neck: R(0.28 * Math.abs(S(t * 7))) } }) },
  shake: { label: "도리도리", dur: 1.3, at: t => ({ j: { neck: R(0, 0.45 * S(t * 11)) } }) },
  clap: { label: "박수", dur: 2.4, at: t => { const c = 0.25 + 0.2 * S(t * 16); return { j: { lShoulder: R(-1.15, 0, c), rShoulder: R(-1.15, 0, -c), lElbow: R(-0.95), rElbow: R(-0.95), neck: R(-0.05) } }; } },
  cheer: { label: "만세", dur: 2.2, legs: true, at: t => ({ j: { lShoulder: R(-0.2, 0, -2.85 - 0.15 * S(t * 9)), rShoulder: R(-0.2, 0, 2.85 + 0.15 * S(t * 9)), lElbow: R(-0.2), rElbow: R(-0.2), neck: R(-0.25) }, lift: 0.07 * Math.abs(S(t * 6)) }) },
  point: { label: "가리키기", dur: 2.0, at: () => ({ j: { rShoulder: R(-1.5, 0, 0.15), rElbow: R(-0.05), neck: R(0, -0.25), spine: R(0, -0.12) } }) },
  shrug: { label: "으쓱", dur: 1.6, at: t => { const k = bell(t, 1.6); return { j: { lShoulder: R(-0.2 * k, 0, -0.55 * k), rShoulder: R(-0.2 * k, 0, 0.55 * k), lElbow: R(-1.5 * k), rElbow: R(-1.5 * k), neck: R(0, 0, 0.18 * k) } }; } },
  salute: { label: "경례", dur: 2.0, at: () => ({ j: { rShoulder: R(-1.25, 0, 1.05), rElbow: R(-2.25), neck: R(-0.05) } }) },
  think: { label: "생각 중", dur: 3.2, at: t => ({ j: { rShoulder: R(-0.95, 0, 0.15), rElbow: R(-2.35), lShoulder: R(-0.45, 0, 0.3), lElbow: R(-1.6), neck: R(0.08, 0.25 + 0.05 * S(t * 2), 0.08) } }) },
  phone: { label: "통화하기", dur: 4.0, at: t => ({ j: { rShoulder: R(-0.55, 0, 0.55), rElbow: R(-2.55), neck: R(0.05, 0.1 * S(t * 1.5), 0.15) } }) },
  lookPhone: { label: "휴대폰 보기", dur: 4.0, at: t => ({ j: { lShoulder: R(-0.55, 0, 0.12), rShoulder: R(-0.55, 0, -0.12), lElbow: R(-1.35), rElbow: R(-1.35 + 0.08 * S(t * 9)), neck: R(0.45) } }) },
  watch: { label: "시계 보기", dur: 1.8, at: () => ({ j: { lShoulder: R(-0.75, 0, 0.45), lElbow: R(-1.55), neck: R(0.4, -0.3) } }) },
  scratch: { label: "머리 긁적", dur: 1.8, at: t => ({ j: { rShoulder: R(-1.75, 0, 0.75), rElbow: R(-1.85 + 0.25 * S(t * 18)), neck: R(0.08, 0, -0.12) } }) },
  crossArms: { label: "팔짱", dur: 4.0, at: () => ({ j: { lShoulder: R(-0.55, 0, 0.32), rShoulder: R(-0.55, 0, -0.32), lElbow: R(-1.95), rElbow: R(-1.95) } }) },
  handsHips: { label: "허리에 손", dur: 3.0, at: () => ({ j: { lShoulder: R(0.25, 0, -0.6), rShoulder: R(0.25, 0, 0.6), lElbow: R(-1.45), rElbow: R(-1.45) } }) },
  stretch: { label: "기지개", dur: 2.6, at: t => { const k = bell(t, 2.6); return { j: { lShoulder: R(-0.2, 0, -2.9 * k), rShoulder: R(-0.2, 0, 2.9 * k), spine: R(-0.2 * k), neck: R(-0.3 * k) } }; } },
  yawn: { label: "하품", dur: 2.2, at: t => { const k = bell(t, 2.2); return { j: { rShoulder: R(-1.5 * k, 0, 0.3 * k), rElbow: R(-2.4 * k), neck: R(-0.3 * k), spine: R(-0.08 * k) } }; } },
  facepalm: { label: "이마 짚기", dur: 2.0, at: () => ({ j: { rShoulder: R(-1.45, 0, 0.25), rElbow: R(-2.6), neck: R(0.38), spine: R(0.08) } }) },
  laugh: { label: "깔깔 웃기", dur: 2.2, at: t => ({ j: { spine: R(0.18 + 0.06 * S(t * 15)), neck: R(-0.25 + 0.05 * S(t * 15)), lShoulder: R(-0.3, 0, -0.15), rShoulder: R(-0.6, 0, 0.2), rElbow: R(-1.6) } }) },
  cry: { label: "엉엉 울기", dur: 2.6, at: t => ({ j: { lShoulder: R(-1.3, 0, 0.22), rShoulder: R(-1.3, 0, -0.22), lElbow: R(-2.35), rElbow: R(-2.35), neck: R(0.32 + 0.05 * S(t * 12)), spine: R(0.12) } }) },
  angry: { label: "발 동동", dur: 2.0, legs: true, at: t => ({ j: { lShoulder: R(-0.1, 0, -0.35), rShoulder: R(-0.1, 0, 0.35), lElbow: R(-1.2), rElbow: R(-1.2), spine: R(0.12), lHip: R(-0.45 * Math.max(0, S(t * 10))), lKnee: R(0.7 * Math.max(0, S(t * 10))) }, lift: 0 }) },
  thumbsUp: { label: "엄지척", dur: 1.8, at: () => ({ j: { rShoulder: R(-1.1, 0, 0.1), rElbow: R(-1.05), neck: R(-0.05, 0, 0.1) } }) },
  heart: { label: "머리 위 하트", dur: 2.4, at: () => ({ j: { lShoulder: R(-0.4, 0, -2.55), rShoulder: R(-0.4, 0, 2.55), lElbow: R(-1.75), rElbow: R(-1.75), neck: R(-0.1) } }) },
  peace: { label: "브이", dur: 2.0, at: () => ({ j: { rShoulder: R(-1.65, 0, 0.35), rElbow: R(-1.95), neck: R(0, 0, 0.12) } }) },
  dance: { label: "신나는 춤", dur: 4.0, loop: true, legs: true, at: t => { const a = S(t * 8), b = S(t * 8 + Math.PI); return { j: { lShoulder: R(-1.2 + 0.8 * a, 0, -0.5), rShoulder: R(-1.2 + 0.8 * b, 0, 0.5), lElbow: R(-1.3), rElbow: R(-1.3), spine: R(0.05, 0.25 * S(t * 4)), neck: R(0, -0.2 * S(t * 4)), lKnee: R(0.3 * Math.max(0, a)), rKnee: R(0.3 * Math.max(0, b)) }, lift: 0.04 * Math.abs(S(t * 8)) }; } },
  robot: { label: "로봇 춤", dur: 4.0, loop: true, at: t => { const k = Math.floor(t * 2.5) % 4; const pose: Record<string, Rot>[] = [{ lShoulder: R(-1.57), lElbow: R(0), rShoulder: R(0, 0, 1.57), rElbow: R(-1.57) }, { lShoulder: R(0, 0, -1.57), lElbow: R(-1.57), rShoulder: R(-1.57), rElbow: R(0) }, { lShoulder: R(-1.57), lElbow: R(-1.57), rShoulder: R(-1.57), rElbow: R(-1.57) }, { lShoulder: R(0, 0, -1.57), lElbow: R(0), rShoulder: R(0, 0, 1.57), rElbow: R(0) }]; return { j: { ...pose[k], neck: R(0, [0.5, -0.5, 0, 0][k]) } }; } },
  groove: { label: "손 흔들며 리듬", dur: 4.0, loop: true, legs: true, at: t => ({ j: { lShoulder: R(-0.3, 0, -2.6 + 0.35 * S(t * 6)), rShoulder: R(-0.3, 0, 2.6 + 0.35 * S(t * 6)), lElbow: R(-0.3), rElbow: R(-0.3), spine: R(0, 0, 0.12 * S(t * 6)), lKnee: R(0.25 * Math.abs(S(t * 6))), rKnee: R(0.25 * Math.abs(S(t * 6))) }, lift: -0.04 * Math.abs(S(t * 6)) }) },
  jump: { label: "기뻐서 점프", dur: 1.8, legs: true, at: t => { const h = Math.max(0, S(t * 7)); return { j: { lShoulder: R(-0.3, 0, -2.6 * h), rShoulder: R(-0.3, 0, 2.6 * h), lHip: R(-0.5 * h), rHip: R(-0.5 * h), lKnee: R(0.9 * h), rKnee: R(0.9 * h) }, lift: 0.28 * h }; } },
  beckon: { label: "이리 와요", dur: 2.0, at: t => ({ j: { rShoulder: R(-1.25, 0, 0.1), rElbow: R(-1.0 - 0.7 * Math.abs(S(t * 6))), neck: R(-0.05, 0, 0.1) } }) },
  stop: { label: "잠깐만요!", dur: 1.6, at: () => ({ j: { rShoulder: R(-1.55, 0, 0.05), rElbow: R(-0.25), neck: R(-0.05) } }) },
  lookAround: { label: "두리번두리번", dur: 3.0, at: t => ({ j: { neck: R(-0.05, 0.75 * S(t * 2.1)), spine: R(0, 0.2 * S(t * 2.1)) } }) },
  kick: { label: "발차기", dur: 1.2, legs: true, at: t => { const k = bell(t, 1.2); return { j: { rHip: R(-1.5 * k), rKnee: R(0.2 * k), lShoulder: R(0, 0, -0.9 * k), rShoulder: R(0.3 * k, 0, 0.9 * k), spine: R(-0.15 * k) } }; } },
  shy: { label: "쑥스러워", dur: 2.4, at: t => ({ j: { lShoulder: R(-0.3, 0, 0.4), rShoulder: R(-0.3, 0, -0.4), lElbow: R(-0.4), rElbow: R(-0.4), neck: R(0.35, 0.25 * S(t * 1.5), 0.15), spine: R(0.06, 0, 0) } }) },
};
export const GESTURE_LIST = Object.keys(GESTURES) as GestureName[];

/** what a part does when it has nothing to do, by its job */
export const IDLE_BY_ROLE: Record<string, GestureName[]> = {
  guard: ["crossArms", "handsHips", "lookAround", "watch", "stretch"],
  clerk: ["handsHips", "lookAround", "stretch", "watch", "nod"],
  desk: ["lookPhone", "stretch", "think", "yawn", "phone"],
  doctor: ["think", "crossArms", "watch", "nod"],
  nurse: ["lookAround", "watch", "handsHips", "nod"],
  patient: ["yawn", "stretch", "lookPhone", "scratch"],
  cook: ["crossArms", "handsHips", "stretch", "thumbsUp"],
  student: ["dance", "laugh", "lookPhone", "jump", "groove", "peace"],
  teacher: ["point", "think", "crossArms", "nod"],
  visitor: ["lookPhone", "phone", "watch", "lookAround", "scratch", "stretch", "yawn", "think"],
  shopper: ["lookPhone", "think", "lookAround", "phone", "scratch", "thumbsUp"],
  guest: ["phone", "lookPhone", "stretch", "yawn", "lookAround"],
};
