import StockIcon from "./StockIcon";
import UsStockIcon from "./UsStockIcon";
import EtfStockLogo from "./EtfStockLogo";

/** Is this a KRX code rather than a US ticker?
 *
 * Six characters beginning with a digit. Not `/^\d{6}$/`, which is what this used to
 * test: KRX issues codes with a trailing letter for 신형우선주 and for names listed under
 * the newer scheme — 00088K (한화 3우B), 0126Z0 (삼성에피스홀딩스), 0009K0 — and those were
 * failing the digits-only test and being sent to the *US* logo host, which of course has
 * nothing for them. They then fell back to a monogram of the first two characters, so a
 * Korean company rendered as "00". Fourteen names across the KOSPI and KOSDAQ 500 hit
 * this.
 *
 * A US ticker never starts with a digit, so the leading-digit test keeps the two markets
 * apart exactly as reliably as the old one did, without excluding half of KRX's own
 * codes. Same rule as search.py's `_resolve_market` is reaching for.
 */
function isKrxCode(code: string): boolean {
  return /^\d[0-9A-Z]{5}$/i.test(code);
}

/** Two characters to stand in for a logo the host does not carry.
 *
 * For a US ticker the ticker itself is the recognisable thing. For a KRX code it is not
 * — "00" says nothing — so the company name's first characters are used when the caller
 * has them, and the code's tail only as a last resort.
 */
function monogram(code: string, name?: string): string {
  if (name?.trim()) return name.trim().slice(0, 2);
  return isKrxCode(code) ? code.slice(-2) : code.slice(0, 2);
}

/** A stock's logo, from whichever market the code belongs to.
 *
 * The two icon components underneath resolve against different hosts and neither can
 * answer for the other's codes — StockIcon asks Naver, which has no logo for AAPL, and
 * UsStockIcon asks companiesmarketcap, which has none for 005930. Anywhere both markets
 * can appear in the same list (the admin dashboard's rankings, live sessions and event
 * tail all mix them) the choice has to be made per row, which is what this is for.
 *
 * Both branches now take a fallback. Neither host is complete: companiesmarketcap covers
 * the index rosters and not the names visitors reach outside them (SPCX, SKHY), and Naver
 * carries no mark for ETNs, REITs or recent listings — 43 names across the three 500-deep
 * rosters this app ranks. A row with an empty square where its neighbours have one reads
 * as broken; a monogram reads as unavailable.
 */
export default function StockLogo({
  code,
  className,
  name,
  assetType = "stock",
}: {
  code: string;
  className: string;
  /** The company name, used for the fallback monogram when the host has no logo. */
  name?: string;
  assetType?: "stock" | "etf";
}) {
  const mark = <span className={`${className} stock-logo--mono`}>{monogram(code, name)}</span>;

  if (assetType === "etf") {
    return (
      <EtfStockLogo
        code={code}
        name={name}
        className={`${className} stock-logo--etf`}
        fallback={mark}
      />
    );
  }

  if (isKrxCode(code)) return <StockIcon code={code} className={className} fallback={mark} />;
  // One shared modifier rather than one derived per caller: every US logo needs the same
  // two corrections to whatever sizing class it was given — `contain` instead of the
  // `cover` the KR icons are styled with (these are wide wordmarks as often as square
  // marks, and cover crops them to a stripe), and a light plate so the dark-on-
  // transparent ones don't vanish on a dark theme.
  return <UsStockIcon code={code} className={`${className} stock-logo--us`} fallback={mark} />;
}
