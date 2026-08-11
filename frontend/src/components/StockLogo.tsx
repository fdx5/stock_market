import StockIcon from "./StockIcon";
import UsStockIcon from "./UsStockIcon";

/** A stock's logo, from whichever market the code belongs to.
 *
 * The two icon components underneath resolve against different hosts and neither can
 * answer for the other's codes — StockIcon asks Naver, which has no logo for AAPL, and
 * UsStockIcon asks companiesmarketcap, which has none for 005930. Anywhere both markets
 * can appear in the same list (the admin dashboard's rankings, live sessions and event
 * tail all mix them) the choice has to be made per row, which is what this is for.
 *
 * The discriminator is the code's own shape, and it is the same rule the backend already
 * uses to route a search result — see search.py's `_resolve_market`: a KRX code is always
 * six digits and a US ticker never is.
 */
export default function StockLogo({ code, className }: { code: string; className: string }) {
  const isKr = /^\d{6}$/.test(code);
  if (isKr) return <StockIcon code={code} className={className} />;
  // One shared modifier rather than one derived per caller: every US logo needs the same
  // two corrections to whatever sizing class it was given — `contain` instead of the
  // `cover` the KR icons are styled with (these are wide wordmarks as often as square
  // marks, and cover crops them to a stripe), and a light plate so the dark-on-
  // transparent ones don't vanish on a dark theme.
  //
  // The fallback matters more since the desk boards started using this. usLogo.ts covers
  // every constituent of both US indices, but these lists are not index lists: the
  // popular ranking is whatever visitors actually looked at, which reaches names in
  // neither (SPCX, SKHY). Without a fallback UsStockIcon renders nothing for those, and
  // a row with an empty square where its neighbours have a mark reads as broken rather
  // than as unavailable. A monogram is always resolvable, since the ticker is the one
  // thing every row has.
  return (
    <UsStockIcon
      code={code}
      className={`${className} stock-logo--us`}
      fallback={<span className={`${className} stock-logo--mono`}>{code.slice(0, 2)}</span>}
    />
  );
}
