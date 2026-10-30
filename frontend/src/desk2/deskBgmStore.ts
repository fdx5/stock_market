import { useSyncExternalStore } from "react";
import { loadApi, YtPlayer } from "../youtubePlayer";
import { BGM_TRACKS, BgmTrack, bgmSession } from "../bgmPlaylist";

/* ============================================================================
   The market desk's background music (the masthead's NOW PLAYING ear).
   ----------------------------------------------------------------------------
   A module-level store rather than a hook's state, for one reason: every desk
   page renders its own <Masthead>, so moving from 부동산 지도 to 종목정보
   unmounts one masthead and mounts another. Music owned by the component would
   stop on every click. Here the player lives in a host appended to <body> once,
   and each masthead only reads and drives it.

   Nothing plays until the reader switches it on, and nothing is even fetched:
   the YouTube API script is loaded on the first ON (or on the pointer arriving
   at the button, as a head start). One random order is shared with the entrance
   for the whole tab session, including reloads and repeat laps.

   The player is YouTube's own IFrame player, off-screen, as on the entrance
   page. Both controls drive this single iframe.
   ========================================================================= */

export type DeskTrack = BgmTrack;
export const DESK_TRACKS = BGM_TRACKS;

export interface DeskBgmState {
  /** The reader's switch. Off is the default and nothing sounds until it is on. */
  on: boolean;
  /** Playing, as asked for — the buttons follow the press, not the network. */
  playing: boolean;
  /** Waiting for the API, the frame or the first buffer. */
  loading: boolean;
  track: DeskTrack;
  /** 1-based place in this visit's order, for the "3 / 6" counter. */
  position: number;
  total: number;
  /** Every track refused to play here (blocked, offline, region-locked). */
  failed: boolean;
  /** A play was asked for and never started — on iOS, a play the browser would
   * not allow outside a tap. The next tap on ▶ plays; the ear says so. */
  blocked: boolean;
}

const VOLUME = 40;
const YT_ENDED = 0;
const YT_PLAYING = 1;
const YT_PAUSED = 2;

let state: DeskBgmState = {
  on: false,
  playing: false,
  loading: false,
  track: bgmSession.track,
  position: bgmSession.position,
  total: DESK_TRACKS.length,
  failed: false,
  blocked: false,
};
const listeners = new Set<() => void>();
function set(patch: Partial<DeskBgmState>) {
  if (Object.entries(patch).every(([key, value]) => state[key as keyof DeskBgmState] === value)) return;
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

let player: YtPlayer | null = null;
let ready = false;
let loadedId: string | null = null;
let building = false;
/** Tracks that refused to play in a row; when it reaches the whole list, stop. */
let refusals = 0;
let host: HTMLDivElement | null = null;
let watchdog: number | undefined;
// Intent is separate from reported state: a delayed PLAYING event must recover
// a watchdog timeout, while a deliberate pause/off must never restart music.
let wantsPlayback = false;
let monitor: number | undefined;

function playerState(): number | null {
  try { return player?.getPlayerState?.() ?? null; } catch { return null; }
}

function reconcilePlayback() {
  if (!ready || !player || !state.on || !wantsPlayback) return;
  const actual = playerState();
  if (actual === YT_PLAYING) {
    window.clearTimeout(watchdog);
    set({ playing: true, loading: false, blocked: false, failed: false });
  } else if (actual === 3) {
    set({ loading: true });
  } else if (actual === YT_PAUSED && !state.loading) {
    set({ playing: false });
  }
}


/* A refused play is silent: no error, the player simply never starts. That is
   what iOS does with a play not made inside a tap — and it would leave the ear
   saying 재생 중 over nothing. If PLAYING has not arrived in four seconds, say
   that a tap is needed instead. */
function armWatchdog() {
  window.clearTimeout(watchdog);
  watchdog = window.setTimeout(() => {
    if (!state.on || !wantsPlayback) return;
    if (playerState() === YT_PLAYING) reconcilePlayback();
    else set({ playing: false, loading: false, blocked: true });
  }, 4000);
}

function hostEl(): HTMLDivElement {
  if (host) return host;
  host = document.createElement("div");
  host.className = "d2-bgm-host";
  host.setAttribute("aria-hidden", "true");
  // Laid out but out of sight: a player that is display:none does not play.
  Object.assign(host.style, { position: "fixed", left: "-10000px", top: "0", width: "200px", height: "200px", overflow: "hidden", pointerEvents: "none" });
  document.body.appendChild(host);
  return host;
}

function select(step: number) {
  bgmSession.advance(step);
  set({ track: bgmSession.track, position: bgmSession.position });
}

function load() {
  if (!player || !ready) return;
  set({ loading: true, blocked: false });
  armWatchdog();
  loadedId = state.track.id;
  player.loadVideoById(state.track.id);
}

function build() {
  if (player || building) return;
  building = true;
  loadApi()
    .then((YT) => {
      const params = new URLSearchParams({
        enablejsapi: "1",
        controls: "0",
        disablekb: "1",
        playsinline: "1",
        rel: "0",
        origin: window.location.origin,
      });
      const frame = document.createElement("iframe");
      loadedId = state.track.id;
      frame.src = `https://www.youtube.com/embed/${state.track.id}?${params.toString()}`;
      frame.allow = "autoplay; encrypted-media";
      frame.title = "market desk background music";
      frame.width = "200";
      frame.height = "200";
      frame.style.border = "0";
      hostEl().appendChild(frame);
      player = new YT.Player(frame, {
        events: {
          onReady: (event) => {
            ready = true;
            window.clearInterval(monitor);
            monitor = window.setInterval(reconcilePlayback, 1000);
            event.target.setVolume(VOLUME);
            // Not inside the reader's tap any more (the script and the frame
            // loaded in between), so iOS may refuse this; the watchdog notices.
            if (state.on && wantsPlayback) {
              armWatchdog();
              loadedId = state.track.id;
              event.target.loadVideoById(state.track.id);
            } else set({ loading: false });
          },
          onStateChange: (event) => {
            if (event.data === YT_PLAYING) {
              window.clearTimeout(watchdog);
              refusals = 0;
              if (!state.on || !wantsPlayback) { event.target.pauseVideo(); return; }
              set({ playing: true, loading: false, failed: false, blocked: false });
            } else if (event.data === 3) {
              if (state.on && wantsPlayback) set({ loading: true });
            } else if (event.data === YT_PAUSED) {
              // Paused by us, or by the system (a locked phone, another app
              // taking the audio) — either way the button should offer ▶.
              // A pause reported mid-load is the player changing tracks, not a
              // stop; honouring it would pause the song we just asked for.
              if (state.loading) return;
              window.clearTimeout(watchdog);
              set({ playing: false });
            } else if (event.data === YT_ENDED) {
              if (!state.on || !wantsPlayback) return;
              next();
            }
          },
          // Embedding refused, removed, or region-locked: move on rather than
          // sit on a silent track — but not round the list forever.
          onError: () => {
            refusals += 1;
            if (refusals >= DESK_TRACKS.length) {
              wantsPlayback = false;
              window.clearTimeout(watchdog);
              set({ on: false, playing: false, loading: false, failed: true });
              return;
            }
            if (state.on) next();
          },
        },
      });
    })
    .catch(() => set({ on: false, playing: false, loading: false, failed: true }))
    .finally(() => {
      building = false;
    });
}

/** Fetches the API ahead of the first press. Safe to call as often as you like. */
export function warmDeskBgm() {
  build();
}

export function setDeskBgmOn(on: boolean) {
  if (on === state.on) return;
  wantsPlayback = on;
  if (!on) {
    window.clearTimeout(watchdog);
    set({ on: false, playing: false, loading: false, blocked: false });
    if (ready) player?.pauseVideo();
    return;
  }
  set({ on: true, playing: true, failed: false, blocked: false, loading: true });
  refusals = 0;
  if (!player) build();
  else if (ready) {
    // Straight from the tap's own call stack — the only play iOS allows.
    armWatchdog();
    if (loadedId !== state.track.id) load();
    else player.playVideo();
    reconcilePlayback();
  }
}

export function toggleDeskBgmPlay() {
  if (!state.on) return setDeskBgmOn(true);
  const playing = !state.playing;
  wantsPlayback = playing;
  set({ playing, blocked: false, loading: playing && ready });
  if (!ready) return;
  if (playing) {
    armWatchdog();
    player?.playVideo();
    reconcilePlayback();
  } else {
    window.clearTimeout(watchdog);
    player?.pauseVideo();
  }
}

/** Drone and normal controls use the same shuffled playlist, without a forced opening song. */
export function startDroneBgm() {
  if (state.on && state.playing) return;
  if (!state.on) return setDeskBgmOn(true);
  wantsPlayback = true;
  set({ playing: true, blocked: false, loading: ready });
  if (!ready) return;
  armWatchdog();
  if (loadedId !== state.track.id) load();
  else player?.playVideo();
  reconcilePlayback();
}

/** Advance in the session's fixed order, wrapping without reshuffling. */
export function next() {
  select(1);
  if (state.on) {
    wantsPlayback = true;
    set({ playing: true });
    load();
  }
}

/** The track before this one in the shuffle — the one actually heard before,
 * once there is one. From the first track it steps to the last of the order,
 * which is a different song, not a restart of this one. */
export function prev() {
  select(-1);
  if (state.on) {
    wantsPlayback = true;
    set({ playing: true });
    load();
  }
}

export function getDeskBgmTime(): number | null {
  if (!ready || !player) return null;
  try {
    const s = player.getCurrentTime?.();
    return typeof s === "number" && Number.isFinite(s) ? s : null;
  } catch { return null; }
}

/* Mounted music controls, including the entrance. When no music-enabled page
   remains, stop playback.
   The delay covers the page switch itself, where one masthead unmounts a moment
   before the next mounts. */
let mounted = 0;
let leaveTimer: number | undefined;
/* Phones stop a YouTube frame's sound when the browser goes to the background —
   YouTube keeps background play for its own app, and nothing a page does can
   hold it. What the page can do is pick the song back up when the reader
   returns: if the music was on and playing as the page went out of sight, it is
   asked to play again the moment the page is visible. iOS may still want a tap
   for that (it is not inside one), in which case the watchdog turns the ear to
   "▶ 탭하여 재생" and one tap carries on from where it stopped. */
let resumeOnReturn = false;
let visibilityListening = false;
function onVisibility() {
  if (document.visibilityState === "hidden") {
    resumeOnReturn = state.on && wantsPlayback;
    return;
  }
  reconcilePlayback();
  if (!resumeOnReturn) return;
  resumeOnReturn = false;
  if (!state.on || !wantsPlayback || !player || !ready) return;
  if (playerState() === YT_PLAYING) { reconcilePlayback(); return; }
  set({ playing: true, loading: true, blocked: false });
  armWatchdog();
  player.playVideo();
  reconcilePlayback();
}

let warmListening = false;
export function attachDeskBgm(): () => void {
  if (!visibilityListening) {
    visibilityListening = true;
    document.addEventListener("visibilitychange", onVisibility);
  }
  mounted += 1;
  window.clearTimeout(leaveTimer);
  /* On a touch screen the player must already be built when the reader taps ON,
     because iOS only lets a play made inside that tap through — and building
     takes a script and a frame. So the first touch anywhere on a desk page
     builds it, paused and silent. A mouse has hover to warm it instead. */
  if (!warmListening && !player && window.matchMedia("(hover: none)").matches) {
    warmListening = true;
    window.addEventListener("pointerdown", () => build(), { once: true, passive: true });
  }
  return () => {
    mounted -= 1;
    window.clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(() => {
      if (mounted === 0) setDeskBgmOn(false);
    }, 800);
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function useDeskBgm(): DeskBgmState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

/** Read current state from event handlers without stale React closures. */
export function getDeskBgmState(): DeskBgmState { return state; }
