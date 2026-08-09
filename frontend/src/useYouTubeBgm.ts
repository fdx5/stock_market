import { useCallback, useEffect, useRef, useState } from "react";

/* ============================================================================
   The entrance page's background music.
   ----------------------------------------------------------------------------
   One YouTube video, played through YouTube's own IFrame Player API.

   The API is the only way this can work. A YouTube watch URL is a web page,
   not a media file — there is nothing behind it that an <audio> element can
   decode, and the URLs that do point at media are signed, short-lived and not
   ours to use. So what plays here is a real YouTube player; it is simply a
   player nobody looks at.

   Two things about that are worth knowing:

   - The player is positioned off-screen rather than removed or display:none'd.
     A player that is not laid out does not reliably play, so it has to exist
     somewhere. See .h2-bgm in hub2.css.
   - YouTube's terms ask that embedded players be visible and at least 200x200.
     This one is neither. That is a deliberate choice to make the request work
     as asked, not an oversight — the CSS is one rule and moving the player
     into view is a one-line change if it ever matters.

   Nothing is fetched until the visitor asks for music. The API script is a
   third-party download and the page is deliberately careful about those, so it
   is pulled on the first press — or, if the pointer gets there first, on the
   press-and-hold before it, which is usually enough of a head start that the
   player is built by the time the click lands.
   ========================================================================= */

/* The playlist. Two tracks, and which one plays is decided fresh every time the
   music is switched on.

   The names here are only what the board shows for the instant before the
   player has been asked its own — see `titleFor`. The player's answer always
   wins, so renaming a video on YouTube changes the board without a deploy. */
const TRACKS = [
  { id: "8PqN8kexaT0", name: "Breath of the Galaxy" },
  { id: "7dn32JVyB6s", name: "Map in Grey" },
  { id: "FbQ3gMEeobg", name: "A Path of Gentle Piano" },
];

/** Which track to play next, never the one just heard.
 *
 * Written as "draw from everything except `excludeId`" rather than as a swap,
 * because with two tracks those are the same thing and with three they are
 * not: a third track added to the list above needs no change here, and the
 * behaviour stays "random, but never twice running" instead of quietly
 * becoming "cycle in order".
 *
 * At two tracks this was strict alternation, because excluding one of two
 * leaves no choice. With three it is what it says: a real draw from the two
 * that are not playing. `excludeId` is null on the first listen of a visit,
 * which is the one time every track is in the hat.
 *
 * The pool guard matters for the one-track case: filtering the only track out
 * would leave nothing to pick and this would return undefined. */
function pickTrack(excludeId: string | null): (typeof TRACKS)[number] {
  const pool = excludeId && TRACKS.length > 1 ? TRACKS.filter((t) => t.id !== excludeId) : TRACKS;
  return pool[Math.floor(Math.random() * pool.length)];
}

const API_SRC = "https://www.youtube.com/iframe_api";
/** Background music, so: audible, and well under whatever else is playing. */
const VOLUME = 45;

interface YtPlayer {
  playVideo(): void;
  pauseVideo(): void;
  /** Swaps the track and starts it. Used for every play after the first —
   * building a second player to change songs would mean a second iframe. */
  loadVideoById(videoId: string): void;
  /** Where in the track it is, in seconds. The equaliser's whole clock. */
  getCurrentTime?: () => number;
  setVolume(volume: number): void;
  getVideoData?: () => { title?: string } | undefined;
  destroy(): void;
}

/* The two player states this cares about. -1 unstarted, 2 paused and 3
   buffering are all states where the track has not changed and nothing needs
   doing. */
const YT_ENDED = 0;
const YT_PLAYING = 1;

interface YtPlayerOptions {
  /* Both optional, and in practice both unused: the player adopts an iframe we
     built ourselves (see build), and for an adopted frame the video and every
     player option come from its URL. They stay on the type because they are
     what you would pass if the API were asked to create the frame instead. */
  videoId?: string;
  playerVars?: Record<string, number | string>;
  events: {
    onReady: (event: { target: YtPlayer }) => void;
    onStateChange: (event: { target: YtPlayer; data: number }) => void;
    onError: () => void;
  };
}

interface YtApi {
  Player: new (host: HTMLElement, options: YtPlayerOptions) => YtPlayer;
}

declare global {
  interface Window {
    YT?: YtApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** The one in-flight load of the API script. Module scope rather than per
 * hook: the script is a singleton on the page whatever asks for it, and a
 * second <script> tag for it would re-run the whole API. */
let apiLoad: Promise<YtApi> | null = null;

function loadApi(): Promise<YtApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiLoad) return apiLoad;

  apiLoad = new Promise<YtApi>((resolve, reject) => {
    // The API announces itself by calling a global. Chain rather than
    // overwrite: this page does not use it elsewhere today, and a hook that
    // quietly breaks whatever does tomorrow is not worth the two lines saved.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube IFrame API loaded without a Player"));
    };

    const tag = document.createElement("script");
    tag.src = API_SRC;
    tag.async = true;
    tag.onerror = () => {
      // Blocked, offline, or refused. Cleared so a later press can retry
      // rather than being stuck against a promise that will never settle.
      apiLoad = null;
      reject(new Error("YouTube IFrame API failed to load"));
    };
    document.head.appendChild(tag);
  });

  return apiLoad;
}

/** One of the videos is titled "... YouTube", and the board is not the place to
 * say where the sound is coming from. Trailing only, and only as a whole word,
 * so a track that genuinely had the word in its name would keep it. */
function cleanTitle(raw: string): string {
  return raw.replace(/[\s\-–—|]*youtube\s*$/i, "").trim() || raw.trim();
}

export interface Bgm {
  /** The track's name, for the marquee. */
  title: string;
  /** Which video is loaded, so the equaliser knows whose envelope to read.
   * Null before anything has been chosen. */
  trackId: string | null;
  /** Where the player is in the track, in seconds, or null if there is no
   * player yet or it will not answer. Stable across renders — the equaliser
   * holds it in an effect dependency. */
  getTime: () => number | null;
  /** What the button should say it is doing. Tracks what the visitor asked
   * for, not what the player has got round to — a button that waits for a
   * network round trip before it changes reads as broken. */
  playing: boolean;
  /** The API would not load, or the video will not play here. */
  failed: boolean;
  /** Where the player has to live. Attach to an element that React owns and
   * never writes into; the player is built as a child of it, so React and the
   * YouTube API never touch the same node. */
  hostRef: React.RefObject<HTMLDivElement>;
  toggle: () => void;
  /** Fetches the API without starting anything, so the first press does not
   * have to wait for it. Safe to call as often as you like. */
  warm: () => void;
}

export function useYouTubeBgm(): Bgm {
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  /* Whatever is on the board. Set optimistically from the local name the
     instant a track is chosen, then overwritten by whatever the player says it
     actually loaded — so the board is right immediately AND stays right if a
     video is retitled on YouTube. */
  const [title, setTitle] = useState(TRACKS[0].name);
  /* Which video is loaded, as state rather than only as the ref below: the
     equaliser is a React effect keyed on it, so it has to re-render to notice
     a track change. The ref stays because the draw logic reads it outside
     render, where state would be a frame behind. */
  const [trackId, setTrackId] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YtPlayer | null>(null);
  /** Which track is on, and so which one the next draw must avoid. Null until
   * something has actually been chosen — that null is what makes the first
   * listen of a visit a free draw rather than forcing it onto whichever track
   * a default would have named. */
  const trackRef = useRef<(typeof TRACKS)[number] | null>(null);
  /* What the visitor last asked for. A ref rather than the state above
     because the player may finish building after several more presses, and
     what it should do when it arrives is whatever was asked for LAST — not
     whatever was asked for on the press that happened to start it. */
  const wantRef = useRef(false);
  const buildingRef = useRef(false);
  const goneRef = useRef(false);
  /* Whether the player has reported for duty. Its methods do not exist until
     it has: `new YT.Player()` returns immediately, but playVideo and the rest
     are attached when the iframe signals ready, and calling one before then
     throws rather than queueing. */
  const readyRef = useRef(false);
  /* Watches a play request to see whether it actually produced sound.
   *
   * A refused play is silent in both senses: the player does not raise
   * onError, it simply does not start. That is what an iPad looked like — the
   * button said BGM OFF, meaning it believed it was playing, over nothing at
   * all. If PLAYING has not arrived by the time this fires, the request was
   * refused and the button should say so. */
  const watchdogRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    /* Cleared on EVERY mount, not just the first.
     *
     * StrictMode runs a component mount, unmount, mount in development, so
     * this effect's cleanup fires once before the component is really alive.
     * Setting the flag there and never clearing it meant that from the second
     * mount onward the hook believed it had been torn down: the API would
     * load, the build would reach its first line, see `gone`, and return. The
     * button turned itself on and there was nothing behind it. */
    goneRef.current = false;
    return () => {
      goneRef.current = true;
      readyRef.current = false;
      window.clearTimeout(watchdogRef.current);
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, []);

  /* Build the player on the visitor's FIRST touch of the page, wherever it
     lands, rather than waiting for the BGM button.
     iOS only grants playback to a call still inside a tap's own stack. On the
     first press the old code had a script to fetch and a frame to load before
     it could ask, so the ask arrived long after the tap was over and was
     refused — silently, which is why the button looked on and nothing played.
     Warmed here, the player is ready and the press can play synchronously.
     Nothing is fetched for a visitor who never interacts, and nothing makes a
     sound: the frame loads paused and waits. */
  useEffect(() => {
    const warmUp = () => build();
    // `once`, and passive: this must not delay or interfere with the gesture
    // it is riding on — the scene is reading these same events to orbit.
    const options = { once: true, passive: true } as const;
    window.addEventListener("pointerdown", warmUp, options);
    window.addEventListener("keydown", warmUp, options);
    return () => {
      window.removeEventListener("pointerdown", warmUp);
      window.removeEventListener("keydown", warmUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Says why, rather than only that. This went wrong once already in a way
     that looked from the outside exactly like the video being unavailable —
     and was not — so the reason belongs somewhere it can be read. */
  const fail = useCallback((reason: unknown) => {
    console.warn("[bgm] could not play", reason);
    window.clearTimeout(watchdogRef.current);
    wantRef.current = false;
    setPlaying(false);
    setFailed(true);
  }, []);

  /** Called on every play request. See watchdogRef for why this exists at all.
   * Three and a half seconds is past any reasonable buffer on a phone and well
   * short of the visitor deciding the button is broken. */
  const armWatchdog = useCallback(() => {
    window.clearTimeout(watchdogRef.current);
    watchdogRef.current = window.setTimeout(() => {
      if (wantRef.current && !goneRef.current) {
        fail("the player never started — the browser most likely refused it");
      }
    }, 3500);
  }, [fail]);

  /** Asks the player what it is playing and puts that on the board. The player
   * is the authority: a video retitled on YouTube shows its new name here with
   * no deploy, and the local names in TRACKS are only the stand-in for the
   * moment before it can answer. */
  const readTitle = useCallback((player: YtPlayer) => {
    const named = player.getVideoData?.()?.title;
    if (named) setTitle(cleanTitle(named));
  }, []);

  /** Draws a track and starts it. Every switch-on goes through here, which is
   * what makes the choice happen per press rather than once per page. */
  const playRandom = useCallback(
    (player: YtPlayer) => {
      // Excluding whatever is on now, which on the "track finished" path is the
      // one that just ended — so listening straight through moves you on to the
      // next song rather than replaying the one you were already hearing.
      const track = pickTrack(trackRef.current?.id ?? null);
      trackRef.current = track;
      // Shown straight away so the board changes with the press rather than a
      // network round trip later; onStateChange corrects it if it differs.
      setTitle(track.name);
      setTrackId(track.id);
      player.loadVideoById(track.id);
      armWatchdog();
    },
    [armWatchdog]
  );

  const build = useCallback(() => {
    const host = hostRef.current;
    if (buildingRef.current || playerRef.current || !host) return;
    buildingRef.current = true;

    loadApi()
      .then((YT) => {
        // Unmounted, or beaten to it, while the script was in flight.
        if (goneRef.current || playerRef.current || !hostRef.current) return;
        /* The iframe is built here rather than left to the API.
         *
         * A cross-origin frame does not inherit the page's user activation
         * unless it is granted it, and without that grant iOS refuses every
         * play we ask for however the request was triggered — which is exactly
         * how this failed on iPad: a button that turned itself on over
         * silence. The grant is the `allow` attribute, and Permissions Policy
         * is read when the frame navigates, so it has to be on the element
         * BEFORE it loads. Setting it on an iframe the API already created is
         * too late to mean anything.
         *
         * So: our iframe, our attributes, and the API adopts it. Passing an
         * existing frame is a documented entry point — it needs enablejsapi=1
         * in the URL, and the player options that would have been playerVars
         * become query parameters, which is the only real difference.
         *
         * `origin` is required by the API for an adopted frame; without it the
         * player and the page cannot talk and onReady never arrives. */
        const track = trackRef.current ?? TRACKS[0];
        const params = new URLSearchParams({
          enablejsapi: "1",
          controls: "0",
          disablekb: "1",
          // Or iOS takes the video full-screen the moment it starts.
          playsinline: "1",
          rel: "0",
          /* No autoplay. It is refused on the platforms that matter here and
             granted on the ones that do not, so all it ever achieved was a
             blip of sound on desktop before the pause that follows. Every play
             is now asked for explicitly, from inside a real gesture. */
          origin: window.location.origin,
        });
        const frame = document.createElement("iframe");
        frame.src = `https://www.youtube.com/embed/${track.id}?${params.toString()}`;
        frame.allow = "autoplay; encrypted-media";
        frame.title = "background music";
        frame.width = "200";
        frame.height = "200";
        frame.style.border = "0";
        hostRef.current.appendChild(frame);

        playerRef.current = new YT.Player(frame, {
          events: {
            onReady: (event) => {
              readyRef.current = true;
              event.target.setVolume(VOLUME);
              readTitle(event.target);
              // Whatever the visitor asked for most recently, including the
              // case where they changed their mind while this was loading.
              /* A play from here is NOT inside the visitor's gesture — the
                 script fetch and the frame load happened in between — so iOS
                 may well refuse it. It is still worth asking: on everything
                 else it works, and the warm-up means this path is rare. The
                 watchdog is what turns a refusal into a button that admits it
                 rather than one that sits on over silence. */
              if (wantRef.current && !goneRef.current) {
                event.target.playVideo();
                armWatchdog();
              } else {
                event.target.pauseVideo();
              }
            },
            onStateChange: (event) => {
              if (event.data === YT_PLAYING) {
                // Sound is actually coming out; the watchdog can stand down.
                window.clearTimeout(watchdogRef.current);
                /* The board catches up here, not at the moment of choosing.
                   getVideoData only answers for the track actually loaded, so
                   this is the first instant the name is known to be right —
                   and it fires on every track change, which is what keeps the
                   marquee honest without anything having to tell it. */
                readTitle(event.target);
              } else if (event.data === YT_ENDED) {
                // One track finished. Draw again rather than repeating it, so
                // the music keeps going and does not become a loop of one song.
                if (!wantRef.current || goneRef.current) return;
                playRandom(event.target);
              }
            },
            onError: () => fail("player reported an error"),
          },
        });
      })
      .catch(fail)
      .finally(() => {
        buildingRef.current = false;
      });
  }, [armWatchdog, fail, playRandom, readTitle]);

  const toggle = useCallback(() => {
    const want = !wantRef.current;
    wantRef.current = want;
    setPlaying(want);
    setFailed(false);

    const player = playerRef.current;
    if (player) {
      /* Built but not yet ready — which is the common case when the pointer
         warmed it a moment ago. Its methods do not exist yet, and calling one
         would throw; its onReady reads wantRef and will do this itself. */
      if (!readyRef.current) return;
      /* Called straight from the click handler, on purpose. iOS grants
         playback to a call that is still inside the tap's own stack and to
         nothing else — no timeout, no promise callback, no matter how soon
         after. This is the path that has to work on an iPad, which is why the
         player is warmed up long before the button is reached. */
      if (want) {
        playRandom(player);
      } else {
        window.clearTimeout(watchdogRef.current);
        player.pauseVideo();
      }
      return;
    }
    // First press: pick before the player is built, so it is constructed
    // already pointed at the chosen track rather than loading one and
    // immediately replacing it.
    if (want) {
      const track = pickTrack(trackRef.current?.id ?? null);
      trackRef.current = track;
      setTitle(track.name);
      setTrackId(track.id);
      build();
    }
  }, [build, playRandom]);

  /* Stable across renders, so the equaliser's effect is not torn down and
     rebuilt on every state change this component makes. It reads the player
     through a ref, so a function created once still finds the current one. */
  const getTime = useCallback((): number | null => {
    if (!readyRef.current) return null;
    const seconds = playerRef.current?.getCurrentTime?.();
    return typeof seconds === "number" && Number.isFinite(seconds) ? seconds : null;
  }, []);

  return { title, trackId, playing, failed, hostRef, toggle, warm: build, getTime };
}
