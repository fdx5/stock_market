const API_SRC = "https://www.youtube.com/iframe_api";

export interface YtPlayer {
  playVideo(): void;
  pauseVideo(): void;
  /** Swaps the track and starts it. Used for every play after the first —
   * building a second player to change songs would mean a second iframe. */
  loadVideoById(videoId: string): void;
  /** Where in the track it is, in seconds. The equaliser's whole clock. */
  getCurrentTime?: () => number;
  getPlayerState?: () => number;
  setVolume(volume: number): void;
  getVideoData?: () => { title?: string } | undefined;
  destroy(): void;
}

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

export function loadApi(): Promise<YtApi> {
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
