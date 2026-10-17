/* The 3D view's pace on fast displays. Its background work — tiles, roads, trees built in slices
 * between frames (frameSlice) — is budgeted for a 60 Hz frame: let in while the frame has used
 * under ~9 ms, given back 14 ms after it began, the next frame due at 16.7. A 120 Hz phone
 * (a Galaxy Z Fold's screen) asks for a frame every 8.3 ms: hovering, the view drew 120 a second
 * (twice the work, the phone heating up), and once the flight streamed tiles every frame ran to
 * the 14 ms deadline past one or two refreshes — from 120 down to 40-odd at the first push of the
 * stick. On a display refreshing at 100 Hz or more the view draws every Nth refresh, N the most
 * that stays at or above 60 a second (120 Hz: every 2nd, 144 Hz: 72 a second, 240 Hz: every 4th),
 * evenly: a refresh is drawn once N refreshes have passed since the last drawn one, less half a
 * refresh. The refresh interval is read from the frame timestamps — their lower fifth, so frames
 * run late under load do not pass for a slow display — and a display that drops to 60 Hz (a
 * phone saving power) is drawn at every refresh again. */

const WINDOW = 60;

export function createFramePace() {
  const gaps: number[] = [];
  let last = -1, lastDrawn = -Infinity, interval = 16.7, every = 1, n = 0;
  return {
    /** Whether the display refresh stamped `stamp` (a requestAnimationFrame time) is drawn. */
    draw(stamp: number): boolean {
      if (last >= 0) {
        const gap = stamp - last;
        if (gap > 0.5 && gap < 100) { gaps.push(gap); if (gaps.length > WINDOW) gaps.shift(); }
      }
      last = stamp;
      if (++n % 15 === 0 && gaps.length >= 20) {
        const sorted = [...gaps].sort((a, b) => a - b);
        interval = sorted[Math.floor(sorted.length * 0.2)];
        every = interval < 9.5 ? Math.max(1, Math.floor(17.17 / interval)) : 1;
      }
      if (every > 1 && stamp - lastDrawn < every * interval - interval / 2) return false;
      lastDrawn = stamp;
      return true;
    },
    /** Refreshes per drawn frame (1: every refresh is drawn). */
    get every() { return every; },
  };
}
