/** Abbreviated display label for the global-TOP20 roster's longer official names,
 * keyed by the same `code` companiesmarketcap.com returns (matches ceoNames.ts's
 * convention). Deliberately language-agnostic brand short forms ("TSMC", "Meta",
 * "Alphabet") rather than per-language strings, since these read correctly in both
 * Korean and English UI without translation. Used only for the NEWS page's tab
 * bar, where the full legal name would otherwise crowd a narrow pill — a company
 * missing here just falls back to its full roster name plus CSS truncation. */
export const COMPANY_SHORT_NAMES: Record<string, string> = {
  GOOG: "Alphabet",
  TSM: "TSMC",
  "2222.SR": "Saudi Aramco",
  META: "Meta",
  "BRK-B": "Berkshire",
  LLY: "Eli Lilly",
  JPM: "JPMorgan",
  AMD: "AMD",
  MU: "Micron",
};
