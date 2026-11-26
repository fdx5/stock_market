import { HoloPanel, NeoEmptyState } from "./NeoComponents";
import { useL } from "../desk2/lib";
import "./stockCatalog.css";

const groups = {
  kospi: ["코스피", "KOSPI"],
  kosdaq: ["코스닥", "KOSDAQ"],
  us: ["미국 주식", "US stocks"],
  "kr-etf": ["국내 ETF", "Korean ETFs"],
  "us-etf": ["미국 ETF", "US ETFs"],
} as const;

type Group = keyof typeof groups;
type Catalog = {
  groups: Partial<Record<Group, number>>;
  group?: Group;
  start?: number;
  pageSize?: number;
  items?: [string, string][];
};

const catalogPath = "/stocks/catalog";

function readCatalog(): Catalog | undefined {
  const element = document.getElementById("stock-catalog-data");
  if (!element?.textContent) return;
  try {
    return JSON.parse(element.textContent) as Catalog;
  } catch {
    return;
  }
}

export default function StockCatalogPage() {
  const L = useL();
  const catalog = readCatalog();
  const group = catalog?.group;
  const title = group ? L(groups[group][0], groups[group][1]) : L("주식·ETF 종목 목록", "Stock and ETF directory");
  const first = (catalog?.start ?? 0) + 1;
  const last = first + (catalog?.items?.length ?? 1) - 1;

  return (
    <main className="ng-stock-catalog">
      <nav aria-label={L("종목 탐색", "Stock navigation")}>
        <a href="/stocks">{L("종목 검색", "Stock search")}</a>
        {group && <a href={catalogPath}>{L("전체 시장 목록", "All markets")}</a>}
      </nav>
      <h1>{title}{group && ` ${first}–${last}`}</h1>
      {catalog?.items ? (
        <HoloPanel>
          <ol start={first}>
            {catalog.items.map(([code, name]) => (
              <li key={code}><a href={`/stock/${code}`}>{name} <small>{code}</small></a></li>
            ))}
          </ol>
        </HoloPanel>
      ) : catalog?.pageSize ? (
        <div className="ng-stock-catalog-groups">
          {(Object.entries(groups) as [Group, typeof groups[Group]][]).map(([key, labels]) => {
            const count = catalog.groups[key];
            const pageSize = catalog.pageSize;
            if (!count || !pageSize) return null;
            return (
              <HoloPanel key={key} title={`${L(labels[0], labels[1])} · ${count.toLocaleString()}`}>
                <ul>
                  {Array.from({ length: Math.ceil(count / pageSize) }, (_, i) => (
                    <li key={i}><a href={`${catalogPath}/${key}/${i + 1}`}>{i * pageSize + 1}–{Math.min((i + 1) * pageSize, count)}</a></li>
                  ))}
                </ul>
              </HoloPanel>
            );
          })}
        </div>
      ) : <NeoEmptyState title={L("종목 목록을 불러올 수 없습니다.", "The stock directory is temporarily unavailable.")} />}
    </main>
  );
}
