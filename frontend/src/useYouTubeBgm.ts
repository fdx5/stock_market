import { useEffect, useRef } from "react";
import {
  attachDeskBgm, getDeskBgmState, getDeskBgmTime, setDeskBgmOn,
  toggleDeskBgmPlay, useDeskBgm, warmDeskBgm,
} from "./desk2/deskBgmStore";

/** The entrance and every inner page share one player and one session order. */
export function useYouTubeBgm() {
  const bgm = useDeskBgm();
  // Kept for the entrance layout's existing host element; the shared player owns its host.
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => attachDeskBgm(), []);
  return {
    title: bgm.track.title,
    trackId: bgm.track.id,
    playing: bgm.on && bgm.playing && !bgm.loading,
    failed: bgm.failed || bgm.blocked,
    hostRef,
    toggle: toggleEntranceBgm,
    warm: warmDeskBgm,
    getTime: getDeskBgmTime,
  };
}

function toggleEntranceBgm() {
  // Resume the current track after a pause/block, and switch off while playing.
  const bgm = getDeskBgmState();
  if (bgm.on && (!bgm.playing || bgm.blocked)) toggleDeskBgmPlay();
  else setDeskBgmOn(!bgm.on);
}
