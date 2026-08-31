import ChartSkeleton from "./ChartSkeleton";

/* The 종목 종합정보 page's own silhouette, shown while the first batch of responses
 * is still in flight.
 *
 * It is built from the page's real layout classes (.si-hero, .si-signal-grid,
 * .si-chart-grid, .si-two-col) rather than a generic spinner block, so the boxes
 * that appear here are the boxes the data lands in — nothing jumps when the real
 * sections replace it. The two shape props are the only places the KR and US pages
 * differ above the chart: KR shows ten signal tiles and a research brief, US shows
 * six tiles and no brief.
 */
export default function StockIntelligenceSkeleton({
  signals = 10,
  brief = true,
  label = "시장 데이터를 정리하고 있습니다…",
}: {
  signals?: number;
  brief?: boolean;
  label?: string;
}) {
  return (
    <main className="si-skeleton">
      <p className="sr-only" role="status">{label}</p>
      <div aria-hidden="true">
        <section className="si-hero">
          <div className="si-identity">
            <span className="skeleton si-skel-logo" />
            <div className="si-skel-stack">
              <span className="skeleton si-skel-line" style={{ width: 96 }} />
              <span className="skeleton si-skel-line si-skel-name" />
              <span className="skeleton si-skel-line" style={{ width: 64 }} />
            </div>
          </div>
          <div className="si-quote si-skel-stack">
            <span className="skeleton si-skel-price" />
            <span className="skeleton si-skel-line" style={{ width: 148 }} />
          </div>
          <div className="si-hero-action">
            <span className="skeleton si-skel-button" />
            <span className="skeleton si-skel-button" />
            <span className="skeleton si-skel-button" />
          </div>
        </section>

        <div className="si-talk-ticker"><span className="skeleton si-skel-ticker" /></div>

        <section className="si-signal-grid">
          {Array.from({ length: signals }, (_, index) => (
            <article key={index}>
              <span className="skeleton si-skel-line" style={{ width: 68 }} />
              <span className="skeleton si-skel-line si-skel-value" />
              <span className="skeleton si-skel-line" style={{ width: 92 }} />
            </article>
          ))}
        </section>

        {brief && (
          <section className="si-research-brief">
            <header>
              <div className="si-skel-stack">
                <span className="skeleton si-skel-line" style={{ width: 108 }} />
                <span className="skeleton si-skel-line si-skel-heading" />
              </div>
              <span className="skeleton si-skel-line" style={{ width: 180 }} />
            </header>
            <div className="si-brief-grid">
              {Array.from({ length: 3 }, (_, index) => (
                <article key={index}>
                  <span className="skeleton si-skel-line" style={{ width: 60 }} />
                  <span className="skeleton si-skel-line si-skel-value" style={{ width: "58%" }} />
                  <span className="skeleton si-skel-line" />
                  <span className="skeleton si-skel-line" style={{ width: "72%" }} />
                </article>
              ))}
            </div>
          </section>
        )}

        <div className="si-section-nav si-skel-nav">
          {Array.from({ length: 8 }, (_, index) => <span key={index} className="skeleton si-skel-pill" />)}
        </div>

        <section className="si-section">
          <header>
            <div className="si-skel-stack">
              <span className="skeleton si-skel-line" style={{ width: 92 }} />
              <span className="skeleton si-skel-line si-skel-heading" />
            </div>
            <span className="skeleton si-skel-line" style={{ width: 220 }} />
          </header>
          <div className="si-chart-grid">
            <div className="si-panel si-price-chart si-skel-chart"><ChartSkeleton /></div>
            <div className="si-panel si-skel-stack">
              {Array.from({ length: 9 }, (_, index) => (
                <span key={index} className="skeleton si-skel-line" style={{ width: `${88 - (index % 4) * 14}%` }} />
              ))}
            </div>
          </div>
        </section>

        <div className="si-two-col">
          {Array.from({ length: 2 }, (_, column) => (
            <section className="si-section" key={column}>
              <header>
                <div className="si-skel-stack">
                  <span className="skeleton si-skel-line" style={{ width: 84 }} />
                  <span className="skeleton si-skel-line si-skel-heading" />
                </div>
              </header>
              <div className="si-panel si-skel-stack">
                {Array.from({ length: 8 }, (_, index) => (
                  <span key={index} className="skeleton si-skel-line" style={{ width: `${94 - (index % 3) * 18}%` }} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
