/* The drone's autopilot callouts: a cockpit-style chime and an English voice as it engages
 * ("Autopilot engaged": a bright rising two-tone) and disengages ("Autopilot disengaged": the
 * falling warble of an autopilot disconnect). The tones are made here (Web Audio); the voice is
 * the browser's own speech synthesis, a female English voice where the system has one —
 * no recording of anyone's voice is shipped. */

let ctx: AudioContext | null = null;
function audio() {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

/** One soft bell-like tone: a sine and its octave, a quick attack and a ringing decay. */
function tone(c: AudioContext, out: AudioNode, at: number, freq: number, length: number, level: number, glide = 0) {
  for (const [mult, part] of [[1, 1], [2, .28], [3, .08]] as const) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(freq * mult, at);
    if (glide) o.frequency.exponentialRampToValueAtTime(freq * mult * glide, at + length);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level * part, at + .012);
    g.gain.exponentialRampToValueAtTime(.0001, at + length);
    o.connect(g).connect(out); o.start(at); o.stop(at + length + .05);
  }
}

function chime(on: boolean) {
  const c = audio(); if (!c) return 0;
  const out = c.createGain(); out.gain.value = .5; out.connect(c.destination);
  const t = c.currentTime + .02;
  if (on) {
    // engaged: two clear rising notes (E6 → A6), the second held
    tone(c, out, t, 1318.5, .35, .32);
    tone(c, out, t + .16, 1760, .7, .3);
    return 700;
  }
  // disengaged: three falling warbles, the disconnect's "wail"
  for (let k = 0; k < 3; k++) tone(c, out, t + k * .22, 1400 - k * 90, .2, .26, .72);
  return 760;
}

let voice: SpeechSynthesisVoice | null | undefined;
function pickVoice(): SpeechSynthesisVoice | null {
  const all = window.speechSynthesis?.getVoices() ?? [];
  if (!all.length) return null;
  const en = all.filter(v => /^en(-|_|$)/i.test(v.lang));
  // A natural-sounding woman's voice, best first: the neural voices (Edge's "Online (Natural)" Aria,
  // Jenny, Ava, Emma, Michelle; macOS/iOS's enhanced/premium Ava, Samantha, Zoe), then Chrome's
  // Google US/UK English (female), the other systems' women's voices; the old robotic Zira last.
  const rank = (v: SpeechSynthesisVoice) => {
    const n = v.name;
    if (/(aria|jenny|ava|emma|michelle|ana|sonia|libby|natasha|clara)\b.*(natural|online|neural)|(natural|neural).*(aria|jenny|ava|emma|michelle|sonia|libby)/i.test(n)) return 0;
    if (/(ava|samantha|zoe|allison|susan|serena|kate|karen|moira|tessa).*(premium|enhanced)/i.test(n)) return 1;
    if (/google us english|google uk english female/i.test(n)) return 2;
    if (/\b(ava|samantha|zoe|allison|susan|serena|karen|moira|tessa|victoria|fiona|female)\b/i.test(n)) return 3;
    if (/zira|hazel|heera/i.test(n)) return 5;
    return 9;
  };
  const sorted = [...en].sort((a, b) => rank(a) - rank(b) || Number(!/en-US/i.test(a.lang)) - Number(!/en-US/i.test(b.lang)));
  return sorted[0] ?? null;
}
if (typeof window !== "undefined" && window.speechSynthesis) {
  window.speechSynthesis.addEventListener?.("voiceschanged", () => { voice = pickVoice(); });
}

function say(text: string) {
  const s = window.speechSynthesis; if (!s) return;
  if (voice === undefined) voice = pickVoice();
  s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = "en-US";
  // (a calm, even delivery: the natural voices at their own pitch, a touch slower)
  u.rate = .94; u.pitch = 1; u.volume = .95;
  s.speak(u);
}

let timer = 0;
/** The callout for the autopilot turning on or off: the chime, then the voice over its tail. */
export function autopilotCallout(on: boolean) {
  window.clearTimeout(timer);
  const lead = chime(on);
  timer = window.setTimeout(() => say(on ? "Autopilot engaged." : "Autopilot disengaged."), Math.max(250, lead - 300));
}
