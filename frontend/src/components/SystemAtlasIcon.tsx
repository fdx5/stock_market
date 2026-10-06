export default function SystemAtlasIcon({ name = "atlas", size = 20 }: { name?: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    atlas: <><path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10"/><path d="m7.5 4.5 9 5v10M16.5 4.5l-9 5v10"/></>,
    client: <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4M3 8h18"/></>,
    graphics: <><path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/></>,
    gateway: <><rect x="4" y="3" width="16" height="7" rx="2"/><rect x="4" y="14" width="16" height="7" rx="2"/><path d="M8 6.5h.1M8 17.5h.1M12 10v4M12 6.5h5M12 17.5h5"/></>,
    market: <><path d="M3 3v18h18M6 16l4-5 4 3 6-9M16 5h4v4"/></>,
    community: <><path d="M4 4h16v13H9l-5 4zM8 8h8M8 12h6"/></>,
    realestate: <><path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7"/></>,
    prediction: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/></>,
    operations: <><path d="M3 12h4l3-7 4 14 3-7h4"/></>,
    support: <><path d="M4 8h12v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM16 9h2a3 3 0 0 1 0 6h-2M7 3v2m4-2v2"/></>,
    cache: <><path d="m13 2-9 12h7l-1 8 10-12h-7z"/></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/></>,
    external: <><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 7h14M5 17h14"/></>,
    search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></>,
    refresh: <><path d="M20 7a9 9 0 1 0 1 7M20 3v5h-5"/></>,
    pause: <><path d="M8 5v14M16 5v14"/></>,
    play: <path d="m7 4 14 8-14 8z"/>,
    expand: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
    back: <path d="M19 12H5m6-6-6 6 6 6"/>,
    code: <path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>,
    download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.external}</svg>;
}
