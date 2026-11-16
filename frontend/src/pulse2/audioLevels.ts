import { envelopeLevel, loadBgmEnvelope, type BgmEnvelope } from "../bgmEnvelope";
import { getDeskBgmState, getDeskBgmTime } from "../desk2/deskBgmStore";

/** Live equaliser levels of the site's background music, for the visuals.
 *
 *  The music plays in a cross-origin YouTube frame, so nothing in the page can analyse it;
 *  each track's spectrum was analysed offline into /bgm/<id>.json (14 bands, ~20 fps) and
 *  is read here at the player's current time. Levels are interpolated between envelope
 *  frames and smoothed with a fast attack and a slower release, so pulses swell with the
 *  beat and settle without jitter. When nothing plays, everything eases down to a calm
 *  idle breathing. */
export interface Levels { bass: number; mid: number; high: number; all: number; beat: number }

export class AudioLevels {
  readonly v: Levels = { bass: 0, mid: 0, high: 0, all: 0, beat: 0 };
  /** Music playing and its envelope known (else the visuals use their own steady glow). */
  live = false;
  private env: BgmEnvelope | null = null;
  private track = "";
  private prevBass = 0;
  private prevAll = 0;

  update(dt: number, now: number) {
    const st = getDeskBgmState();
    const id = (st?.track as { id?: string } | undefined)?.id ?? "";
    if (id && id !== this.track) { this.track = id; this.env = null; void loadBgmEnvelope(id).then(e => { if (this.track === id) this.env = e; }); }
    // (read a touch ahead: the frame is seen a little after it is drawn)
    const t0 = st?.playing ? getDeskBgmTime() : null, t = t0 === null ? null : t0 + 0.06;
    let bass = 0, mid = 0, high = 0, all = 0;
    this.live = !!(this.env && t !== null);
    if (this.env && t !== null) {
      const e = this.env, f = t * e.fps, f0 = Math.floor(f), k = f - f0;
      const at = (band: number, bars: number) => {
        const a = envelopeLevel(e, f0 / e.fps, band, bars), b = envelopeLevel(e, (f0 + 1) / e.fps, band, bars);
        return a + (b - a) * k;
      };
      bass = (at(0, 7) + at(1, 7)) / 2; mid = (at(2, 7) + at(3, 7) + at(4, 7)) / 3; high = (at(5, 7) + at(6, 7)) / 2;
      all = bass * 0.45 + mid * 0.35 + high * 0.2;
    } else {
      // (no music: a slow breath so the pulses never stop flowing)
      const b = 0.5 + 0.5 * Math.sin(now * 0.7);
      bass = 0.18 + 0.12 * b; mid = 0.16 + 0.08 * Math.sin(now * 0.45 + 1); high = 0.12; all = 0.16 + 0.08 * b;
    }
    const v = this.v;
    const follow = (cur: number, target: number) => cur + (target - cur) * (1 - Math.exp(-dt * (target > cur ? 30 : 7)));
    v.bass = follow(v.bass, bass); v.mid = follow(v.mid, mid); v.high = follow(v.high, high); v.all = follow(v.all, all);
    // A beat: the bass rising quickly; decays smoothly.
    // (a rise in the bass or the whole mix; frame-rate independent)
    const rise = Math.max(0, bass - this.prevBass, (all - this.prevAll) * 0.8) * 8 * Math.min(1, 1 / 60 / Math.max(dt, 1e-3) * 1.0) ;
    this.prevAll = all;
    this.prevBass = bass;
    v.beat = Math.max(v.beat * Math.exp(-dt * 6), Math.min(1, rise * 1.6));
  }
}
