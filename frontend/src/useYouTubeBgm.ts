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

/** https://youtu.be/8PqN8kexaT0 */
const VIDEO_ID = "8PqN8kexaT0";
const API_SRC = "https://www.youtube.com/iframe_api";
/** Background music, so: audible, and well under whatever else is playing. */
const VOLUME = 45;

interface YtPlayer {
  playVideo(): void;
  pauseVideo(): void;
  setVolume(volume: number): void;
  getVideoData?: () => { title?: string } | undefined;
  destroy(): void;
}

interface YtPlayerOptions {
  videoId: string;
  playerVars: Record<string, number | string>;
  events: {
    onReady: (event: { target: YtPlayer }) => void;
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

/** Shown until the player has been asked its own name for the first time. */
const FALLBACK_TITLE = "Breath of the Galaxy";

/** The video is titled "... YouTube", and the board is not the place to say
 * where the sound is coming from. Trailing only, and only as a whole word, so
 * a track that genuinely had the word in its name would keep it. */
function cleanTitle(raw: string): string {
  return raw.replace(/[\s\-–—|]*youtube\s*$/i, "").trim() || raw.trim();
}

export interface Bgm {
  /** The track's name, for the marquee. */
  title: string;
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
  const [title, setTitle] = useState(FALLBACK_TITLE);
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YtPlayer | null>(null);
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
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, []);

  /* Says why, rather than only that. This went wrong once already in a way
     that looked from the outside exactly like the video being unavailable —
     and was not — so the reason belongs somewhere it can be read. */
  const fail = useCallback((reason: unknown) => {
    console.warn("[bgm] could not play", reason);
    wantRef.current = false;
    setPlaying(false);
    setFailed(true);
  }, []);

  const build = useCallback(() => {
    const host = hostRef.current;
    if (buildingRef.current || playerRef.current || !host) return;
    buildingRef.current = true;

    loadApi()
      .then((YT) => {
        // Unmounted, or beaten to it, while the script was in flight.
        if (goneRef.current || playerRef.current || !hostRef.current) return;
        // The API REPLACES the element it is given with its iframe, so it gets
        // a node of its own rather than the host React is rendering.
        const target = document.createElement("div");
        hostRef.current.appendChild(target);

        playerRef.current = new YT.Player(target, {
          videoId: VIDEO_ID,
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            // A single video does not loop on its own — `loop` needs a
            // playlist to loop, and a playlist of one is this video.
            loop: 1,
            playlist: VIDEO_ID,
            // Or iOS takes the video full-screen the moment it starts.
            playsinline: 1,
            rel: 0,
          },
          events: {
            onReady: (event) => {
              readyRef.current = true;
              event.target.setVolume(VOLUME);
              /* The track's name, read off the player rather than written
                 down here — it stays right if the video is ever retitled, and
                 there is nowhere else on the page it could go stale. */
              const named = event.target.getVideoData?.()?.title;
              if (named) setTitle(cleanTitle(named));
              // Whatever the visitor asked for most recently, including the
              // case where they changed their mind while this was loading.
              if (wantRef.current && !goneRef.current) event.target.playVideo();
              else event.target.pauseVideo();
            },
            onError: () => fail("player reported an error"),
          },
        });
      })
      .catch(fail)
      .finally(() => {
        buildingRef.current = false;
      });
  }, [fail]);

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
      if (want) player.playVideo();
      else player.pauseVideo();
      return;
    }
    if (want) build();
  }, [build]);

  return { title, playing, failed, hostRef, toggle, warm: build };
}
