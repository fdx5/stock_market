/** CEO/chairman portrait for each global-TOP20 roster company, keyed by the same
 * `code` companiesmarketcap.com returns. Files live in /img/ceo/ (downloaded from
 * each person's Wikipedia lead image on Wikimedia Commons — freely licensed; see the
 * page links below for author attribution). A company missing here (roster rotation,
 * new entrant) falls back to its logo, so this map going stale is cosmetic only.
 *
 * Sources: en.wikipedia.org pages for Jensen Huang, Tim Cook, Sundar Pichai, Satya
 * Nadella, Andy Jassy, Hock Tan, Amin H. Nasser, Mark Zuckerberg, Elon Musk, Lee
 * Jae-yong, Warren Buffett, David A. Ricks, Sanjay Mehrotra, Doug McMillon, Jamie
 * Dimon, Lisa Su, Ryan McInerney; zh.wikipedia.org for C.C. Wei (魏哲家);
 * Chey Tae-won (SK Group chairman) stands in for SK Hynix, whose CEO Kwak Noh-jung
 * has no Wikipedia portrait.
 */
export interface CeoImage {
  src: string;
  person: string;
}

const sanitize = (code: string): string => code.replace(/[^A-Za-z0-9]/g, "_");

const PEOPLE: Record<string, string> = {
  NVDA: "Jensen Huang",
  AAPL: "Tim Cook",
  GOOG: "Sundar Pichai",
  MSFT: "Satya Nadella",
  AMZN: "Andy Jassy",
  TSM: "C.C. Wei",
  AVGO: "Hock Tan",
  "2222.SR": "Amin H. Nasser",
  META: "Mark Zuckerberg",
  SPCX: "Elon Musk",
  TSLA: "Elon Musk",
  "005930.KS": "Lee Jae-yong",
  "BRK-B": "Warren Buffett",
  LLY: "David A. Ricks",
  MU: "Sanjay Mehrotra",
  WMT: "Doug McMillon",
  JPM: "Jamie Dimon",
  "000660.KS": "Chey Tae-won",
  AMD: "Lisa Su",
  V: "Ryan McInerney",
};

export function ceoImageFor(code: string): CeoImage | null {
  const person = PEOPLE[code];
  if (!person) return null;
  return { src: `/img/ceo/${sanitize(code)}.jpg`, person };
}
