import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { navigate, navigationSnapshot, useRoute } from "../src/router";
import { ReadingRestoration } from "../src/browsingMemory";
import { jumpTo } from "../src/desk2/shell";
import { api } from "../src/api/client";
import News from "../src/desk2/reader/News";
import Discussion from "../src/desk2/reader/Discussion";
import StocksPage from "../src/desk2/stocks/StocksPage";
import "../src/desk2/pages.css";

// All feed data is synthetic. No backend or stored database is used.
api.news = async () => ({ code: "TEST", name: "Test", items: Array.from({length: 18}, (_, i) => ({ title: `Article ${i+1}`, press: "Fixture", date: "2026-10-23", summary: "Test", link: `https://example.test/${i}` })) });
api.board = async () => {
  await new Promise(resolve => setTimeout(resolve, 180));
  return { items: Array.from({length: 20}, (_, i) => ({ nid: String(i+1), title: `Post ${i+1}`, author: "Fixture", date: "2026-10-23", views: 1, likes: 0, dislikes: 0 })) } as any;
};
api.boardDetail = async () => ({ title: "Fixture post", blocks: [{ type: "text", text: "Body" }] }) as any;
api.boardComments = async () => ({ items: [] }) as any;
api.newsArticle = async () => ({ paragraphs: Array.from({length: 15}, () => "Fixture article paragraph.") }) as any;

function LongPage() {
  return <main><section id="intro" style={{height: 900}}>Intro</section><section id="target" style={{height: 1600}}>Target</section><footer style={{height: 500}}>Footer</footer></main>;
}
const SlowPage = lazy(async () => { await new Promise(resolve => setTimeout(resolve, 350)); return { default: LongPage }; });

function Fixture() {
  const path = useRoute();
  const location = navigationSnapshot();
  let page = <LongPage />;
  if (path === "/slow") page = <SlowPage />;
  if (path === "/map") page = <main><div style={{height: 700}}>Map controls</div><div data-scroll-start="map" data-scroll-ready="true" style={{height: 1600}}>Map area</div><footer style={{height: 800}}>Footer</footer></main>;
  if (path === "/reader-news") page = <main><div style={{height: 950}}/><News code="TEST" name="Test" source="naver-finance"/><div style={{height: 1500}}/></main>;
  if (path === "/reader-talk") page = <main><div style={{height: 950}}/><Discussion code="TEST" name="Test" source="naver"/><div style={{height: 1500}}/></main>;
  if (path === "/stocks") page = <StocksPage />;
  return <><style>{`body{margin:0}.qa-header{height:96px;position:fixed;top:0;z-index:999;background:white;width:100%}.rd-list li{min-height:90px}.rd-article p{min-height:90px}`}</style><header className="qa-header" data-d2-sticky><button onClick={() => navigate('/slow')}>Slow route</button><button onClick={() => navigate('/desk')}>Fresh desk</button><button onClick={() => jumpTo('target')}>Jump</button></header><Suspense key={location.url} fallback={<p>Loading fixture</p>}>{page}<ReadingRestoration key={location.entry} {...location}/></Suspense></>;
}
(window as any).scrollQA = { navigate, jumpTo };
createRoot(document.getElementById("root")!).render(<React.StrictMode><Fixture /></React.StrictMode>);
