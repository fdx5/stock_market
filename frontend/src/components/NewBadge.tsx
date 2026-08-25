/** The pulsing "N" that marks a recently added destination in the nav row.
 *
 * Extracted from MarketBubbleNavLink, which had it inline, because a second page now
 * carries one and the map pages render a third copy inside their nav loop — three
 * hand-written spans that have to keep agreeing on a class name and an aria-label is
 * two more than necessary.
 *
 * The class keeps its original name so the existing rule in styles.css still applies
 * unchanged; `.nav-new-badge` is declared alongside it as the name to use from here on.
 */
export default function NewBadge() {
  return (
    <span className="market-bubble-new nav-new-badge" aria-label="신규">
      N
    </span>
  );
}
