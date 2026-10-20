import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const video = i => ({ id: String(i).padStart(11, '0'), rank: i + 1, title: `나스닥 미국주식 분석 ${i}`, channel: '테스트 채널', views: 20000 - i, published_at: '2026-10-19T09:00:00+09:00', duration_seconds: 610, thumbnail: 'https://i.ytimg.com/vi/test/hqdefault.jpg', url: `https://www.youtube.com/watch?v=${i}`, topic: '시장읽기' });
const holding = { code: 'AAPL', name: 'Apple', weight_pct: 100, previous_weight_pct: 50, weight_change_pct: 50, shares: 10, reference_price: 100, purchase_price: null, current_price: 120, current_weight_pct: 100, reference_return_pct: 20, daily_change_pct: -1.25, activity: 'new' };
const investor = { id: 'buffett', name: '워런 버핏', name_en: 'Warren Buffett', firm: 'Berkshire Hathaway', color: '#487b70', style: '가치·장기', available: true, top_holdings: [holding], period: 'Q2 2026', report_date: '2026-06-30', holding_count: 1, top3_weight: 100, new_count: 1, add_count: 0, reported_value: 1000, photo_url: 'https://example.test/portrait.jpg', photo_source: 'https://example.test/credit', photo_credit: 'Creator', photo_license: 'CC BY 2.0', photo_license_url: 'https://creativecommons.org/licenses/by/2.0/' };
const edition = { status: 'ready', edition: '2026-10-20', refreshing: false, stale: false, collected_at: '2026-10-19T23:02:00Z' };
globalThis.__editorialRender = { paths: [], data: {
  'videos?market=us': { ...edition, market: 'us', items: Array.from({ length: 20 }, (_, i) => video(i)) },
  'videos?market=kr': { ...edition, market: 'kr', items: Array.from({ length: 20 }, (_, i) => ({ ...video(i), title: `코스피 국내주식 분석 ${i}` })) },
  investors: { ...edition, items: [investor], available_count: 1, consensus: [] },
  'investors/buffett': { ...edition, investor, holdings: [holding], valuation_complete: true },
} };
globalThis.window = { location: { search: '', pathname: '/desk' }, localStorage: { getItem: () => null }, print() {} };

async function components(entry) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(`../src/${entry}`, import.meta.url))], bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], loader: { '.css': 'empty' }, plugins: [{ name: 'memory-page-environment', setup(b) {
    b.onLoad({ filter: /discover[\\/]api\.ts$/ }, args => ({ contents: readFileSync(args.path, 'utf8').replace(/export function useEditorial<T>[\s\S]*?(?=export const formatViews)/, `export function useEditorial<T>(path:string) { globalThis.__editorialRender.paths.push(path); return {data:globalThis.__editorialRender.data[path] ?? null, error:false}; }\n`), loader: 'ts' }));
    b.onResolve({ filter: /(?:router|LanguageContext|useDocumentTitle|useActivityTracking|watchlist|useMarketSnapshot|useUsMarketSnapshot|useMarketIndices|useMarketTicker|usePopularStocks|api\/client|deskBgmStore)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'mock' }));
    b.onResolve({ filter: /(?:^|\/)(?:shell|Masthead|Colophon|CommandBar|CommodityDesk|Finder|FlowDesk|GlobalDesk|MobileDock|RankingDesk|RoomDesk|SpotlightDesk|StockLogo|MarketChart)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => {
      const code = {
        router: `import React from 'react'; export const Link=({to,children,...props})=>React.createElement('a',{href:to,...props},children); export const navigate=()=>{};`,
        LanguageContext: `export const useLanguage=()=>({lang:'ko'});`,
        useDocumentTitle: `export const useDocumentTitle=()=>{};`,
        useActivityTracking: `export const reportStockView=()=>{};`, watchlist: `export const recordRecent=()=>{};`,
        useMarketSnapshot: `export const useMarketSnapshot=()=>({kospi:[],kosdaq:[],generatedAt:null});`,
        useUsMarketSnapshot: `export const useUsMarketSnapshot=()=>({all:[],sp500:[],nasdaq:[],generatedAt:null,session:'post'});`,
        useMarketIndices: `export const useMarketIndices=()=>({kospi:{close:3000,change_pct:1},kosdaq:{close:1000,change_pct:-1}});`,
        useMarketTicker: `export const useMarketTicker=()=>[{symbol:'^GSPC',price:6000},{symbol:'^NDX',price:20000},{symbol:'CL=F',price:75.12},{symbol:'GC=F',price:2700.5},{symbol:'SI=F',price:32.4},{symbol:'BTC-USD',price:95000.25},{symbol:'XRP-USD',price:2.1234}].map(q=>({...q,label:q.symbol,change:1,change_pct:1.25,points:[]}));`,
        usePopularStocks: `export const usePopularStocks=()=>[];`, client: `export const api=new Proxy({},{get:()=>async()=>({items:[]})});`,
        shell: `export const useBroadsheet=()=>{}; export const useFinderHotkey=()=>{}; export const useScrollSpy=()=>{}; export const jumpTo=()=>{};`,
        RoomDesk: `export const Radar=()=>null; export const Talk=()=>null;`,
        deskBgmStore: `export const useDeskBgm=()=>({playing:false}); export const toggleDeskBgmPlay=()=>{};`,
      }[path] ?? `export default ()=>null;`;
      return { contents: code, loader: 'jsx' };
    });
  } }] });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}

const render = (Component, props = {}) => renderToStaticMarkup(React.createElement(Component, props));

test('domestic desk combines old front/1/2 panels and puts investors above Korean stock videos', async () => {
  window.location.search = '';
  const { default: Page } = await components('desk2/Desk2Page.tsx');
  const html = render(Page);
  assert(html.indexOf('id="d2-front"') < html.indexOf('id="d2-investors"'));
  assert(html.indexOf('id="d2-investors"') < html.indexOf('id="d2-videos"'));
  assert(!html.includes('id="d2-index"') && !html.includes('id="d2-breadth"'));
  assert(html.includes('/investment-videos?market=kr'));
  assert.equal((html.match(/class="ed-video-card"/g) ?? []).length, 4);
  assertOverviewAssetsAndTape(html);
});

test('global uses its own US feed and keeps detailed sector panels collapsed', async () => {
  const { default: Page } = await components('desk2/world/WorldPage.tsx');
  const html = render(Page);
  assert(html.indexOf('id="w-front"') < html.indexOf('id="w-investors"'));
  assert(html.indexOf('id="w-investors"') < html.indexOf('id="w-videos"'));
  assert(html.includes('오늘, 함께 보는 미국 증시'));
  assert(html.includes('/investment-videos?market=us'));
  assert(!html.includes('id="w-sectors"') && !html.includes('id="w-bigtech"'));
  assert(!html.includes('<details class="ed-market-details" open'));
  assertOverviewAssetsAndTape(html);
});

function assertOverviewAssetsAndTape(html) {
  const overview = html.slice(html.indexOf('class="ed-market-overview"'), html.indexOf('class="ed-discovery-section'));
  for (const label of ['WTI 유가', '금 선물', '은 선물', '비트코인', '리플 XRP']) assert(overview.includes(label));
  for (const value of ['$75.12', '$2,700.50', '$32.40', '$95,000.25', '$2.1234']) assert(overview.includes(value));
  assert(html.includes('role="marquee"'));
  assert(!html.includes('NaN'));
}

test('independent video page renders twenty cards and correct market navigation', async () => {
  window.location.search = '?market=us';
  const { InvestmentVideosPage } = await components('desk2/discover/DiscoveryPages.tsx');
  const html = render(InvestmentVideosPage);
  assert.equal((html.match(/class="ed-video-card"/g) ?? []).length, 20);
  assert(html.includes('href="/global"'));
  assert(html.includes('공식 순위는 아닙니다'));
  assert(html.includes('08:00 KST'));
});

test('portfolio renders disclosed weights and live prices without invented purchase cost', async () => {
  const { InvestorPortfolioPage } = await components('desk2/discover/DiscoveryPages.tsx');
  const html = render(InvestorPortfolioPage, { investorId: 'buffett' });
  assert(html.includes('공시 비중') && html.includes('이전 분기 비중'));
  assert(html.includes('$120.00') && html.includes('-1.25%'));
  assert(!html.includes('$100.00') && !html.includes('+20.00%'));
  assert(!html.includes('공개 기준가') && !html.includes('기준가 대비'));
  assert(html.includes('실제 매입단가 미공개'));
  assert(html.includes('투자자의 실제 수익률'));
  assert(html.includes('https://finance.yahoo.com/quote/AAPL/'));
  assert(html.includes('https://creativecommons.org/licenses/by/2.0/'));
});

test('full quarter portfolio shows sold positions and labels option underlying prices', async () => {
  const wood = { ...investor, id: 'wood', name: '캐시 우드', data_basis: 'sec_13f', previous_report_date: '2026-03-31', has_options: true };
  const option = { ...holding, code: 'PLTR', position_id: '123:put', asset_type: 'put', current_price: null, underlying_price: 170, daily_change_pct: null, reference_return_pct: null };
  const sold = { ...holding, code: 'MSFT', position_id: '456:equity', activity: 'sold', shares: 0, weight_pct: 0, previous_weight_pct: 5, weight_change_pct: -5, current_price: null, daily_change_pct: null };
  __editorialRender.data['investors/wood'] = { ...edition, investor: wood, holdings: [option], exited_holdings: [sold] };
  const { InvestorPortfolioPage } = await components('desk2/discover/DiscoveryPages.tsx');
  const html = render(InvestorPortfolioPage, { investorId: 'wood' });
  assert(html.includes('전량 매도') && html.includes('MSFT'));
  assert(html.includes('PUT 옵션') && html.includes('기초자산 시세 · 옵션 가격 아님'));
  assert(html.includes('$170.00') && html.includes('별도 시세 확인 중'));
  assert(!html.includes('기준가 대비'));
});

test('empty source renders recovery state without fabricated recommendations', async () => {
  const previous = __editorialRender.data['videos?market=us'];
  __editorialRender.data['videos?market=us'] = { ...edition, status: 'unavailable', items: [] };
  const { InvestmentVideosPage } = await components('desk2/discover/DiscoveryPages.tsx');
  const html = render(InvestmentVideosPage);
  assert(!html.includes('class="ed-video-card"'));
  assert(html.includes('이번 회차를 확인하고 있습니다'));
  __editorialRender.data['videos?market=us'] = previous;
});
