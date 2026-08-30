"""Real CEO/chairman name + photo for a company, via Wikidata rather than scraping
Wikipedia's prose or infobox wikitext — company -> "chief executive officer" (P169)
-> that person's "image" (P18) is structured data, so this doesn't need to guess at
Wikipedia page titles or parse infobox markup the way a text scrape would.

Every P18 image on Wikidata/Commons is freely licensed by construction: Commons
(where these files actually live) only accepts freely-licensed or public-domain
uploads, and Wikipedia's own policy for photos of living people goes further and
disallows non-free/fair-use images for them entirely — so a claim reachable this way
was already required to clear that bar before it could exist. Hotlinked directly from
upload.wikimedia.org/Special:FilePath, the same way flagcdn.com flags are hotlinked
elsewhere in this app, rather than downloaded into this repo.

P169 frequently carries more than one value - every former CEO Wikidata still has a
record for, not just the current one - so _current_claim_id below has to pick the
right one out rather than taking claims[0].
"""

import logging
import re
import time

import requests

logger = logging.getLogger(__name__)

WIKIDATA_API = "https://www.wikidata.org/w/api.php"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; KStockHub/1.0; +https://kospimap.com) "
        "python-requests"
    ),
}

_session = requests.Session()
_session.headers.update(HEADERS)

# Wikidata's search/entity endpoints are noticeably touchier about request bursts than
# the market-data scrapes elsewhere in this app - a tight loop with no pacing at all
# started coming back with connection resets in testing. Three calls per company
# (search, company claims, CEO claims+label) at this spacing keeps a 100-company nightly
# run under ~3 minutes, which is fine for a background job nobody is waiting on.
_REQUEST_DELAY_SECONDS = 0.4


def _get(params: dict) -> dict:
    time.sleep(_REQUEST_DELAY_SECONDS)
    resp = _session.get(WIKIDATA_API, params={**params, "format": "json"}, timeout=8)
    resp.raise_for_status()
    return resp.json()


# companiesmarketcap sometimes appends a parenthetical to disambiguate a name for its
# own site ("Alphabet (Google)", "Meta Platforms (Facebook)") - Wikidata's own entity
# is filed under the plain name, and searching with the parenthetical still attached
# returns zero candidates (confirmed against both examples above), turning an entity
# Wikidata actually has good data for into a false "not found".
_PARENTHETICAL_RE = re.compile(r"\s*\([^)]*\)\s*$")


def _clean_company_name(company_name: str) -> str:
    return _PARENTHETICAL_RE.sub("", company_name).strip()


def _find_company_qid(company_name: str) -> str | None:
    data = _get(
        {
            "action": "wbsearchentities",
            "search": _clean_company_name(company_name),
            "language": "en",
            "type": "item",
            "limit": 1,
        }
    )
    results = data.get("search") or []
    return results[0]["id"] if results else None


def _get_claims(qid: str, prop: str) -> list[dict]:
    data = _get({"action": "wbgetclaims", "entity": qid, "property": prop})
    return data.get("claims", {}).get(prop, [])


def _current_claim_id(claims: list[dict]) -> str | None:
    """Picks the officeholder claim that's still current out of however many P169
    values a company's Wikidata item carries. "preferred" rank is how Wikidata itself
    marks the current one when a property has multiple values; falling back to "no
    P582 (end time) qualifier" covers items where nobody has set that rank explicitly
    but has recorded when each predecessor's term ended."""
    if not claims:
        return None
    preferred = [c for c in claims if c.get("rank") == "preferred"]
    pool = preferred or [c for c in claims if "P582" not in c.get("qualifiers", {})]
    pool = pool or claims
    try:
        return pool[0]["mainsnak"]["datavalue"]["value"]["id"]
    except (KeyError, IndexError, TypeError):
        return None


def _get_label_and_image(qid: str) -> tuple[str | None, str | None]:
    data = _get({"action": "wbgetentities", "ids": qid, "props": "labels|claims", "languages": "en"})
    entity = (data.get("entities") or {}).get(qid) or {}
    label = ((entity.get("labels") or {}).get("en") or {}).get("value")

    image_claims = (entity.get("claims") or {}).get("P18") or []
    if not image_claims:
        return label, None
    try:
        filename = image_claims[0]["mainsnak"]["datavalue"]["value"]
    except (KeyError, IndexError, TypeError):
        return label, None

    # Special:FilePath redirects straight to the file (no page-scrape needed to find
    # the actual upload.wikimedia.org URL), and takes a width param for a right-sized
    # thumbnail instead of pulling full original-resolution files onto a 132px tile.
    filename_encoded = filename.replace(" ", "_")
    photo_url = f"https://commons.wikimedia.org/wiki/Special:FilePath/{filename_encoded}?width=300"
    return label, photo_url


def get_ceo_photos_bulk(company_names: list[str]) -> dict[str, dict]:
    """CEO name+photo for many companies, keyed by the exact name passed in. Called
    sequentially (not threaded) by the nightly full-snapshot refresh - see the module
    docstring for why this needs real pacing between Wikidata calls; a thread pool
    would defeat that. At ~1.2s/company (3 calls each) a 100-company run costs about
    two minutes, acceptable for a job nothing user-facing waits on."""
    out: dict[str, dict] = {}
    for name in company_names:
        result = get_ceo_photo(name)
        if result:
            out[name] = result
    return out


def get_ceo_photo(company_name: str) -> dict | None:
    """{"name": ..., "photo_url": ...|None} for `company_name`'s current CEO, or None
    if the chain comes up completely empty (company not found on Wikidata, or no
    officeholder claim at all). `photo_url` alone is commonly missing - plenty of
    sitting CEOs have a P169 claim but no P18 image on Wikidata yet - and that's not
    a reason to throw away a name we did successfully resolve; the frontend already
    falls back to the plain company logo when photo_url is None. Every step is
    independent-failure-tolerant by returning None rather than raising - a company or
    CEO missing structured data on Wikidata is routine, not an error worth logging
    past debug level."""
    try:
        company_qid = _find_company_qid(company_name)
        if not company_qid:
            return None
        ceo_qid = _current_claim_id(_get_claims(company_qid, "P169"))
        if not ceo_qid:
            # P169 (chief executive officer) is the precise property, but plenty of
            # companies' Wikidata items only ever got P1037 (director/manager) filled
            # in - confirmed against Oracle, where P1037 correctly points to Safra
            # Catz (its actual CEO) while P169 has no claim at all.
            ceo_qid = _current_claim_id(_get_claims(company_qid, "P1037"))
        if not ceo_qid:
            return None
        name, photo_url = _get_label_and_image(ceo_qid)
        if not name:
            return None
        return {"name": name, "photo_url": photo_url}
    except Exception:  # noqa: BLE001 - one company's failure must not sink the batch
        logger.debug("ceo_photo_fetcher: failed for %s", company_name, exc_info=True)
        return None
