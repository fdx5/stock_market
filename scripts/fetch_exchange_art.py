"""Fetch the atrium's art collection: public-domain paintings (Wikimedia Commons) and CC0 sculptures (Poly Haven).

    python scripts/fetch_exchange_art.py <sources>

Paintings: every artist died more than 70 years ago (public domain); Commons reproductions of 2D
public-domain works are public domain. For each painting this writes, under frontend/public:
  3d/exchange-floor/art/<id>.jpg      3,840 px long edge — the viewer (brush strokes and canvas visible)
  3d/exchange-floor/art/<id>-1k.webp  1,024 px — the picture on the wall in 3D
and frontend/src/exchange/art.json (titles, artists, years, sizes, sources). The large files are
published to the asset repository (scripts/publish_public_subset.py), not served from this repo's host.
"""
from io import BytesIO
import json
from pathlib import Path
import sys
import time
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "frontend/public/3d/exchange-floor/art"
META = ROOT / "frontend/src/exchange/art.json"
AGENT = "KOSPIMAP Exchange Floor (https://kospimap.com)"
Image.MAX_IMAGE_PIXELS = None

# id, Commons search (title words), Korean title, English title, artist (ko / en), year, physical width (m, for the wall)
PAINTINGS = [
    ("starry-night", "File:Van Gogh - Starry Night - Google Art Project.jpg", "별이 빛나는 밤", "The Starry Night", "빈센트 반 고흐", "Vincent van Gogh", "1889", 1.6),
    ("sunflowers", "Vincent Willem van Gogh 127 Sunflowers", "해바라기", "Sunflowers", "빈센트 반 고흐", "Vincent van Gogh", "1888", 1.2),
    ("cafe-terrace", "Van Gogh Cafe Terrace at Night Yorck", "밤의 카페 테라스", "Café Terrace at Night", "빈센트 반 고흐", "Vincent van Gogh", "1888", 1.2),
    ("almond-blossom", "Vincent van Gogh Almond blossom Google Art Project", "꽃 피는 아몬드 나무", "Almond Blossom", "빈센트 반 고흐", "Vincent van Gogh", "1890", 1.5),
    ("irises", "Irises Vincent van Gogh Getty", "붓꽃", "Irises", "빈센트 반 고흐", "Vincent van Gogh", "1889", 1.5),
    ("water-lilies", "Claude Monet Water Lilies 1906 Ryerson", "수련", "Water Lilies", "클로드 모네", "Claude Monet", "1906", 1.5),
    ("impression-sunrise", "Monet Impression Sunrise", "인상, 해돋이", "Impression, Sunrise", "클로드 모네", "Claude Monet", "1872", 1.5),
    ("woman-parasol", "Claude Monet Woman with a Parasol Madame Monet and Her Son Google Art Project", "양산을 쓴 여인", "Woman with a Parasol", "클로드 모네", "Claude Monet", "1875", 1.2),
    ("the-kiss", "The Kiss Gustav Klimt Google Cultural Institute", "키스", "The Kiss", "구스타프 클림트", "Gustav Klimt", "1908", 1.5),
    ("pearl-earring", "1665 Girl with a Pearl Earring", "진주 귀걸이를 한 소녀", "Girl with a Pearl Earring", "요하네스 페르메이르", "Johannes Vermeer", "1665", 1.0),
    ("milkmaid", "Johannes Vermeer Het melkmeisje Google Art Project", "우유 따르는 여인", "The Milkmaid", "요하네스 페르메이르", "Johannes Vermeer", "1658", 1.0),
    ("great-wave", "Tsunami by hokusai 19th century", "가나가와 해변의 높은 파도 아래", "The Great Wave off Kanagawa", "가쓰시카 호쿠사이", "Katsushika Hokusai", "1831", 1.5),
    ("red-fuji", "Red Fuji southern wind clear morning", "개풍쾌청", "Fine Wind, Clear Morning", "가쓰시카 호쿠사이", "Katsushika Hokusai", "1831", 1.5),
    ("birth-of-venus", "Sandro Botticelli La nascita di Venere Google Art Project edited", "비너스의 탄생", "The Birth of Venus", "산드로 보티첼리", "Sandro Botticelli", "1485", 2.0),
    ("mona-lisa", "Mona Lisa by Leonardo da Vinci from C2RMF retouched", "모나리자", "Mona Lisa", "레오나르도 다 빈치", "Leonardo da Vinci", "1503", 1.0),
    ("night-watch", "La ronda de noche por Rembrandt van Rijn", "야경", "The Night Watch", "렘브란트 판 레인", "Rembrandt van Rijn", "1642", 2.2),
    ("grande-jatte", "A Sunday on La Grande Jatte Georges Seurat 1884", "그랑드 자트 섬의 일요일 오후", "A Sunday on La Grande Jatte", "조르주 쇠라", "Georges Seurat", "1886", 2.0),
    ("moulin-galette", "Pierre-Auguste Renoir Le Moulin de la Galette", "물랭 드 라 갈레트의 무도회", "Bal du moulin de la Galette", "피에르오귀스트 르누아르", "Pierre-Auguste Renoir", "1876", 1.8),
    ("the-scream", "Edvard Munch 1893 The Scream oil tempera and pastel on cardboard National Gallery of Norway", "절규", "The Scream", "에드바르 뭉크", "Edvard Munch", "1893", 1.0),
    ("wanderer", "Caspar David Friedrich Wanderer above the sea of fog", "안개 바다 위의 방랑자", "Wanderer above the Sea of Fog", "카스파르 다비트 프리드리히", "Caspar David Friedrich", "1818", 1.1),
    ("hunters-snow", "Pieter Bruegel the Elder Hunters in the Snow Winter Google Art Project", "눈 속의 사냥꾼", "The Hunters in the Snow", "피터르 브뤼헐", "Pieter Bruegel the Elder", "1565", 1.8),
    ("arnolfini", "Van Eyck Arnolfini Portrait", "아르놀피니 부부의 초상", "The Arnolfini Portrait", "얀 반 에이크", "Jan van Eyck", "1434", 1.0),
    ("las-meninas", "Las Meninas by Diego Velazquez from Prado in Google Earth", "시녀들", "Las Meninas", "디에고 벨라스케스", "Diego Velázquez", "1656", 1.6),
    ("temeraire", "The Fighting Temeraire JMW Turner National Gallery", "전함 테메레르", "The Fighting Temeraire", "윌리엄 터너", "J. M. W. Turner", "1839", 1.8),
    ("card-players", "Les Joueurs de cartes par Paul Cezanne", "카드놀이 하는 사람들", "The Card Players", "폴 세잔", "Paul Cézanne", "1895", 1.4),
    ("where-from", "Paul Gauguin D'ou venons-nous", "우리는 어디서 왔는가", "Where Do We Come From?", "폴 고갱", "Paul Gauguin", "1897", 2.4),
    ("school-of-athens", "The School of Athens by Raffaello Sanzio da Urbino", "아테네 학당", "The School of Athens", "라파엘로 산치오", "Raphael", "1511", 2.2),
    ("folies-bergere", "Edouard Manet A Bar at the Folies-Bergere", "폴리베르제르의 술집", "A Bar at the Folies-Bergère", "에두아르 마네", "Édouard Manet", "1882", 1.6),
    ("dance-class", "Edgar Degas The Dance Class Google Art Project", "발레 수업", "The Dance Class", "에드가 드가", "Edgar Degas", "1874", 1.3),
    ("ssireum", "Kim Hong-do Ssireum Danwon pungsokdo", "씨름", "Ssireum (Wrestling)", "김홍도", "Kim Hong-do", "18th c.", 1.0),
    ("inwang", "Jeong Seon Inwang jesaekdo", "인왕제색도", "Clearing After Rain on Mount Inwang", "정선", "Jeong Seon", "1751", 1.8),
    ("miindo", "Miindo Hyewon Shin Yun-bok beauty", "미인도", "Portrait of a Beauty", "신윤복", "Sin Yun-bok", "19th c.", .8),
]
SCULPTURES = ["marble_bust_01", "horse_statue_01", "gothic_statue", "bronze_whale_statue", "bronze_ray_statue",
              "horse_head", "lion_head", "carved_wooden_elephant", "antique_ceramic_vase_01"]


def get(url, tries=4):
    for k in range(tries):
        try:
            with urlopen(Request(url, headers={"User-Agent": AGENT}), timeout=120) as r:
                return r.read()
        except Exception:
            if k == tries - 1:
                raise
            time.sleep(2 + 3 * k)


def commons(query):
    """Best Commons file for a title query (or the exact file when query starts with "File:")."""
    if query.startswith("File:"):
        data = json.loads(get("https://commons.wikimedia.org/w/api.php?" + urlencode(
            {"action": "query", "format": "json", "titles": query, "prop": "imageinfo", "iiprop": "url|size|mime", "iiurlwidth": 3840})))
        page = list(data["query"]["pages"].values())[0]
        return page["title"], page["imageinfo"][0]
    params = {"action": "query", "format": "json", "generator": "search", "gsrsearch": query, "gsrnamespace": 6,
              "gsrlimit": 6, "prop": "imageinfo", "iiprop": "url|size|mime", "iiurlwidth": 3840}
    data = json.loads(get("https://commons.wikimedia.org/w/api.php?" + urlencode(params)))
    pages = sorted(data.get("query", {}).get("pages", {}).values(), key=lambda p: p.get("index", 99))
    for p in pages:
        info = (p.get("imageinfo") or [{}])[0]
        if info.get("mime") in ("image/jpeg", "image/png", "image/tiff") and info.get("width", 0) >= 1600:
            return p["title"], info
    raise LookupError(query)


def painting(item):
    pid, query, ko, en, artist_ko, artist_en, year, width = item
    title, info = commons(query)
    big = OUT_DIR / f"{pid}.jpg"
    if big.exists() and (OUT_DIR / f"{pid}-1k.webp").exists():   # already fetched: metadata only
        image = Image.open(big)
    else:
        url = info.get("thumburl") or info["url"]
        image = Image.open(BytesIO(get(url))).convert("RGB")
        long = max(image.size)
        if long > 3840:
            image = image.resize((round(image.width * 3840 / long), round(image.height * 3840 / long)), Image.Resampling.LANCZOS)
        image.save(big, quality=90, optimize=True, progressive=True)
        small = image.copy()
        small.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
        small.save(OUT_DIR / f"{pid}-1k.webp", quality=88, method=6)
    print(pid, image.size, title, flush=True)
    return {"id": pid, "ko": ko, "en": en, "artistKo": artist_ko, "artistEn": artist_en, "year": year, "width": width,
            "aspect": round(image.width / image.height, 4), "source": "https://commons.wikimedia.org/wiki/" + quote(title.replace(" ", "_")),
            "license": "Public domain"}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sources = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    done = []
    for item in PAINTINGS:
        try:
            done.append(painting(item))
        except Exception as error:   # keep going; report the misses
            print("MISS", item[0], error, flush=True)
        time.sleep(.6)
    META.write_text(json.dumps({"paintings": done, "sculptures": SCULPTURES}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    if sources:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from fetch_exchange_sources import polyhaven  # noqa: E402
        for key in SCULPTURES:
            if not (sources / key).exists():
                polyhaven(sources, key)
    print(len(done), "paintings")
