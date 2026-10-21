const paths: Record<string, string> = {
  chart: "M3 17l5-5 4 3 8-10M15 5h5v5M3 21h18", map: "m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15", spark: "m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z", layers: "m12 3 10 6-10 6L2 9l10-6Zm-10 12 10 6 10-6M2 12l10 6 10-6", orbit: "M16 5a8 8 0 1 0 3 12M3 15C-1 9 16-1 21 4s-5 17-11 18M19 7h.01", search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z", settings: "M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6M10 15v6", menu: "M4 6h16M4 12h16M4 18h16", close: "m6 6 12 12M18 6 6 18", home: "m3 10 9-7 9 7v11h-7v-7h-4v7H3V10Z", arrow: "M5 12h14m-5-5 5 5-5 5", news: "M4 3h16v18H4V3Zm4 4h8m-8 4h8m-8 4h3m2 0h3", globe: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z", chevron: "m9 5 7 7-7 7", bolt: "m13 2-9 12h7l-1 8 10-13h-8l1-7Z",
};
export default function NeoIcon({ name, className = "" }: { name: string; className?: string }) {
  return <svg className={`ng-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.chart} /></svg>;
}
