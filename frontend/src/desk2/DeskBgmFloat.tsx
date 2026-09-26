import { useEffect } from "react";
import DeskBgm from "./DeskBgm";
import { attachDeskBgm, useDeskBgm } from "./deskBgmStore";

/* The desk's music on the pages that are not broadsheets — 종목토론, 증시버블,
   증시궤도. They have no masthead to carry the NOW PLAYING ear, so without this
   the music would stop on arrival (the store stops it when no desk page is
   holding it). Here it carries on, and the same player floats in the corner so
   it can still be paused, skipped or switched off. Nothing shows while the music
   is off: these pages are full-screen scenes and a player nobody started is only
   in the way. */
export default function DeskBgmFloat() {
  const bgm = useDeskBgm();
  useEffect(() => attachDeskBgm(), []);
  if (!bgm.on) return null;
  return (
    <div className="d2 d2-bgm-float">
      <DeskBgm variant="strip" />
    </div>
  );
}
