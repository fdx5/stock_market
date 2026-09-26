import { useSyncExternalStore } from "react";
import { loadApi, YtPlayer } from "../useYouTubeBgm";

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
   at the button, as a head start). The order is shuffled once per page load —
   so the track waiting behind the button is already a random one — and stepping
   through it with ◀◀ / ▶▶ never lands on the song that is playing.

   The player is YouTube's own IFrame player, off-screen, as on the entrance
   page — see useYouTubeBgm for why nothing else can play a YouTube link.
   ========================================================================= */

export interface DeskTrack {
  id: string;
  /** What the ear shows. The videos' own titles are search-engine sentences
   * ("Deep Work Music for the CEO MODE - Early Morning Before…"), so these are
   * written for a 200px line; the channel is credited underneath. */
  title: string;
  channel: string;
  /** How the decorative equaliser moves for this track — see deskEqualizer. */
  bpm: number;
  energy: number;
  bass: number;
  bright: number;
}

export const DESK_TRACKS: DeskTrack[] = [
  { id: "6pUPGG7LLEc", title: "CEO Mode · Early Morning Deep Work", channel: "Power Hour Focus", bpm: 76, energy: 0.62, bass: 0.45, bright: 0.35 },
  { id: "GZBPveuGaT8", title: "Zen Mode · Deep Focus", channel: "Power Hour Focus", bpm: 64, energy: 0.5, bass: 0.3, bright: 0.25 },
  { id: "RhZLTbsDzqo", title: "Intense Coding · Deep House", channel: "deep archive", bpm: 122, energy: 0.85, bass: 0.9, bright: 0.7 },
  { id: "PuVO9fow2iI", title: "새벽 도서관 무드 · 집중 로파이", channel: "onia music", bpm: 82, energy: 0.58, bass: 0.55, bright: 0.4 },
  { id: "Uhmq6gmLpGQ", title: "Discipline · Deep Work Music", channel: "Deep Idle Room", bpm: 70, energy: 0.55, bass: 0.4, bright: 0.3 },
  { id: "hydk9hHO1Ko", title: "Focus Like a CEO · Penthouse Mix", channel: "FOCUS ZONE", bpm: 110, energy: 0.75, bass: 0.7, bright: 0.55 },
];

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

/** A shuffle of every track, whose first is not `avoid` — so a new lap of the
 * playlist never opens with the song the last lap closed on. */
function shuffled(avoid: string | null): number[] {
  const order = DESK_TRACKS.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (avoid && order.length > 1 && DESK_TRACKS[order[0]].id === avoid) order.push(order.shift()!);
  return order;
}

let order = shuffled(null);
let cursor = 0;
let state: DeskBgmState = {
  on: false,
  playing: false,
  loading: false,
  track: DESK_TRACKS[order[0]],
  position: 1,
  total: DESK_TRACKS.length,
  failed: false,
  blocked: false,
};
const listeners = new Set<() => void>();
function set(patch: Partial<DeskBgmState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

let player: YtPlayer | null = null;
let ready = false;
let building = false;
/** Tracks that refused to play in a row; when it reaches the whole list, stop. */
let refusals = 0;
let host: HTMLDivElement | null = null;
let watchdog: number | undefined;

/* A refused play is silent: no error, the player simply never starts. That is
   what iOS does with a play not made inside a tap — and it would leave the ear
   saying 재생 중 over nothing. If PLAYING has not arrived in four seconds, say
   that a tap is needed instead. */
function armWatchdog() {
  window.clearTimeout(watchdog);
  watchdog = window.setTimeout(() => {
    if (state.on && state.playing) set({ playing: false, loading: false, blocked: true });
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

function select(nextCursor: number) {
  cursor = nextCursor;
  set({ track: DESK_TRACKS[order[cursor]], position: cursor + 1 });
}

function load() {
  if (!player || !ready) return;
  set({ loading: true, blocked: false });
  player.loadVideoById(state.track.id);
  armWatchdog();
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
            event.target.setVolume(VOLUME);
            // Not inside the reader's tap any more (the script and the frame
            // loaded in between), so iOS may refuse this; the watchdog notices.
            if (state.on && state.playing) {
              event.target.loadVideoById(state.track.id);
              armWatchdog();
            } else set({ loading: false });
          },
          onStateChange: (event) => {
            if (event.data === YT_PLAYING) {
              window.clearTimeout(watchdog);
              refusals = 0;
              set({ loading: false, failed: false, blocked: false });
              if (!state.on || !state.playing) event.target.pauseVideo();
            } else if (event.data === YT_PAUSED) {
              // Paused by us, or by the system (a locked phone, another app
              // taking the audio) — either way the button should offer ▶.
              // A pause reported mid-load is the player changing tracks, not a
              // stop; honouring it would pause the song we just asked for.
              if (state.loading) return;
              window.clearTimeout(watchdog);
              set({ playing: false });
            } else if (event.data === YT_ENDED) {
              if (state.on && state.playing) next();
            }
          },
          // Embedding refused, removed, or region-locked: move on rather than
          // sit on a silent track — but not round the list forever.
          onError: () => {
            refusals += 1;
            if (refusals >= DESK_TRACKS.length) {
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
    player.playVideo();
    armWatchdog();
  }
}

export function toggleDeskBgmPlay() {
  if (!state.on) return setDeskBgmOn(true);
  const playing = !state.playing;
  set({ playing, blocked: false, loading: playing && ready });
  if (!ready) return;
  if (playing) {
    player?.playVideo();
    armWatchdog();
  } else {
    window.clearTimeout(watchdog);
    player?.pauseVideo();
  }
}

/** The next track in this visit's shuffle; past the end, a fresh shuffle that
 * does not open on the song just heard. Never the same song twice running. */
export function next() {
  if (cursor + 1 < order.length) select(cursor + 1);
  else {
    order = shuffled(state.track.id);
    select(0);
  }
  if (state.on) {
    set({ playing: true });
    load();
  }
}

/** The track before this one in the shuffle — the one actually heard before,
 * once there is one. From the first track it steps to the last of the order,
 * which is a different song, not a restart of this one. */
export function prev() {
  select(cursor > 0 ? cursor - 1 : order.length - 1);
  if (state.on) {
    set({ playing: true });
    load();
  }
}

export function getDeskBgmTime(): number | null {
  if (!ready || !player) return null;
  const s = player.getCurrentTime?.();
  return typeof s === "number" && Number.isFinite(s) ? s : null;
}

/* Mounted mastheads. When the reader leaves the desk entirely (the entrance
   page has music of its own), the desk's stops rather than playing under it.
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
    resumeOnReturn = state.on && state.playing;
    return;
  }
  if (!resumeOnReturn) return;
  resumeOnReturn = false;
  if (!state.on || !player || !ready) return;
  set({ playing: true, loading: true, blocked: false });
  player.playVideo();
  armWatchdog();
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
