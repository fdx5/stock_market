import { GlobalIndexWidget } from "../api/client";
import { Skel, Spark } from "./parts";
import { pct, toneOf, useGlobalIndices, useL } from "./lib";

/* 03 해외 증시.
 *
 * The classic grid rolled ten indices through two flip-tiles, which meant eight
 * of them were hidden at any moment and a reader who wanted the Nikkei waited
 * for it to come round. Ten numbers fit on one line of a wide page, so here they
 * all sit still: two groups, as the backend tags them — the US majors (with the
 * KOSPI 200 night-futures print while its session is open) and the overseas
 * markets. */

function value(v: number, unit: "index" | "usd"): string {
  const s = v.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: v < 1000 ? 2 : 0 });
  return unit === "usd" ? `$${s}` : s;
}

function Tile({ item }: { item: GlobalIndexWidget }) {
  const L = useL();
  const tone = toneOf(item.change_pct);
  const closes = item.points.map((p) => p.close).filter(Number.isFinite);
  const prev = item.close !== null && item.change !== null ? item.close - item.change : null;
  const hi = closes.length ? Math.max(...closes) : null;
  const lo = closes.length ? Math.min(...closes) : null;
  const last = item.points[item.points.length - 1]?.date?.slice(5).replace("-", ".") ?? "";
  return (
    <article className={`d2-gl is-${tone}`}>
      <header>
        {item.flag && <img src={`/img/flag/${item.flag}.svg`} alt="" loading="lazy" />}
        <h3>{item.label}</h3>
        {last && <time>{last}</time>}
      </header>
      {item.close !== null ? (
        <>
          <div className="d2-gl-val">
            <b>{value(item.close, item.unit)}</b>
            <span>{pct(item.change_pct)}</span>
          </div>
          <Spark points={closes} tone={tone} baseline={prev} className="d2-gl-spark" />
          <dl>
            <div>
              <dt>{L("전일", "Prev")}</dt>
              <dd>{prev === null ? "—" : value(prev, item.unit)}</dd>
            </div>
            <div>
              <dt>{L("고", "Hi")}</dt>
              <dd>{hi === null ? "—" : value(hi, item.unit)}</dd>
            </div>
            <div>
              <dt>{L("저", "Lo")}</dt>
              <dd>{lo === null ? "—" : value(lo, item.unit)}</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="d2-gl-empty">—</p>
      )}
    </article>
  );
}

export default function GlobalDesk() {
  const L = useL();
  const items = useGlobalIndices();
  if (items === null) {
    return (
      <div className="d2-gl-grid">
        {Array.from({ length: 10 }, (_, i) => (
          <Skel key={i} h={150} />
        ))}
      </div>
    );
  }
  const us = items.filter((it) => it.group !== "overseas");
  const overseas = items.filter((it) => it.group === "overseas");
  return (
    <div className="d2-gl-groups">
      <section>
        <h3 className="d2-gl-group">{L("미국 · 레버리지 · 야간선물", "US · leveraged · KOSPI futures")}</h3>
        <div className="d2-gl-grid">
          {us.map((it) => (
            <Tile key={it.key} item={it} />
          ))}
        </div>
      </section>
      <section>
        <h3 className="d2-gl-group">{L("아시아 · 유럽", "Asia · Europe")}</h3>
        <div className="d2-gl-grid">
          {overseas.map((it) => (
            <Tile key={it.key} item={it} />
          ))}
        </div>
      </section>
    </div>
  );
}
