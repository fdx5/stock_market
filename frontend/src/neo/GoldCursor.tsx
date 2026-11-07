import { useEffect } from "react";
import "./goldCursor.css";

export default function GoldCursor() {
  useEffect(() => {
    const root=document.documentElement;
    const previous=root.dataset.neonCursor;
    const media=matchMedia("(any-hover: hover) and (any-pointer: fine)");
    const sync=()=>{if(media.matches)root.dataset.neonCursor="gold";else delete root.dataset.neonCursor;};
    sync();media.addEventListener("change",sync);
    return ()=>{media.removeEventListener("change",sync);if(previous)root.dataset.neonCursor=previous;else delete root.dataset.neonCursor;};
  },[]);
  return null;
}
