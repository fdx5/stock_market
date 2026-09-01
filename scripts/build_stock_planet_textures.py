"""Build optimized 4K material sets from result3 for the market orbit."""
from pathlib import Path
import math, re, sys, warnings
from PIL import Image, ImageChops

SOURCE = Path(r"I:\ai_root\textures_planets\result3")
DESTINATION = Path(__file__).resolve().parents[1] / "planet-assets/stock-planets-v3"
TARGET_SIZE = (2048, 1024)
PREVIEW_SIZE = (512, 256)
MATERIAL_SIZE = (2048, 1024)
SEAM_WIDTH = 12
SKIP_FOLDERS = {"Desert+03(1) (1)", "textures"}
Image.MAX_IMAGE_PIXELS = None
warnings.simplefilter("ignore", Image.DecompressionBombWarning)

def slug(value: str) -> str:
    variant = "-variant-2" if "2+4k" in value.lower() else ""
    value = re.sub(r"\([^)]*(?:4k|2\+4k)[^)]*\)", "", value, flags=re.I)
    value = re.sub(r"\(1\)$", "", value)
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") + variant

def files_for(folder: Path) -> list[Path]:
    return [p for p in folder.iterdir() if p.suffix.lower() in {".png", ".jpg", ".jpeg"}]

def readable(path: Path) -> bool:
    try:
        with Image.open(path) as image: image.verify()
        return True
    except Exception:
        print(f"Ignoring unreadable source map: {path.name}", flush=True)
        return False

def pick(paths: list[Path], token: str, exclude: tuple[str, ...] = ()) -> Path | None:
    choices = [p for p in paths if token in p.name.lower() and not any(x in p.name.lower() for x in exclude) and readable(p)]
    if not choices: return None
    return sorted(choices, key=lambda p: (bool(re.search(rf"{re.escape(token)}\s+[23]", p.name, re.I)), len(p.name)))[0]

def open_map(path: Path, mode: str, size: tuple[int, int]) -> Image.Image:
    with Image.open(path) as source:
        source.load(); image = source.convert(mode)
    if image.size != size:
        image = image.resize(size, Image.Resampling.LANCZOS)
    return image

def seamless(image: Image.Image) -> Image.Image:
    image = image.copy(); width, height = image.size
    seam_width = max(8, round(SEAM_WIDTH * width / TARGET_SIZE[0]))
    for distance in range(seam_width):
        right_x = width - 1 - distance
        left = image.crop((distance, 0, distance + 1, height))
        right = image.crop((right_x, 0, right_x + 1, height))
        matched = Image.blend(left, right, 0.5)
        strength = 0.5 * (1.0 + math.cos(math.pi * distance / seam_width))
        image.paste(Image.blend(left, matched, strength), (distance, 0))
        image.paste(Image.blend(right, matched, strength), (right_x, 0))
    return image

def save_color(image: Image.Image, path: Path, quality: int) -> None:
    seamless(image).save(path, "WEBP", quality=quality, method=4, exact=True)

def save_mask(image: Image.Image, path: Path, quality: int) -> None:
    seamless(image.convert("L")).save(path, "WEBP", quality=quality, method=4)

def main() -> None:
    if not SOURCE.exists(): raise FileNotFoundError(SOURCE)
    DESTINATION.mkdir(parents=True, exist_ok=True); manifest = []
    requested = set(sys.argv[1:])
    folders = [p for p in sorted(SOURCE.iterdir()) if p.is_dir() and p.name not in SKIP_FOLDERS and (not requested or p.name in requested)]
    for folder in folders:
        paths = files_for(folder)
        diffuse = pick(paths, "diffuse") or pick(paths, "albedo")
        if diffuse is None:
            print(f"Skipping {folder.name}: no equirectangular diffuse map"); continue
        height = pick(paths, "bump", ("cloud",)) or pick(paths, "elevation") or pick(paths, "height")
        cloud = pick(paths, "cloud", ("bump", "normal", "opacity"))
        roughness = pick(paths, "roughness") or pick(paths, "specular") or pick(paths, "metallic")
        emissions = [p for p in paths if any(t in p.name.lower() for t in ("lights", "lava", "emissive")) and readable(p)]
        case_id = slug(folder.name); target = DESTINATION / case_id; target.mkdir(parents=True, exist_ok=True)
        surface = open_map(diffuse, "RGB", TARGET_SIZE)
        save_color(surface, target / "surface.webp", 90)
        # The overview only renders planets a few pixels wide on phones. Shipping
        # the 2K source there delays first texture paint; the full map is still loaded
        # when the user focuses a planet.
        save_color(surface.resize(PREVIEW_SIZE, Image.Resampling.LANCZOS), target / "surface-preview.webp", 82)
        if height: save_mask(open_map(height, "L", MATERIAL_SIZE), target / "height.webp", 88)
        if cloud:
            cloud_image = open_map(cloud, "RGBA", MATERIAL_SIZE)
            # Encoding a full 4K RGBA WebP makes the lossless alpha plane dominate
            # transfer size. Separate color and opacity so both can be tuned.
            save_color(cloud_image.convert("RGB"), target / "cloud.webp", 88)
            alpha = cloud_image.getchannel("A")
            if alpha.getextrema() == (255, 255): alpha = cloud_image.convert("L")
            save_mask(alpha, target / "cloud-alpha.webp", 88)
        if roughness: save_mask(open_map(roughness, "L", MATERIAL_SIZE), target / "roughness.webp", 88)
        if emissions:
            layers = [open_map(p, "RGB", MATERIAL_SIZE) for p in emissions]; emission = layers[0]
            for layer in layers[1:]: emission = ImageChops.lighter(emission, layer)
            save_color(emission, target / "emissive.webp", 88)
        manifest.append({"id":case_id,"label":re.sub(r"\+"," ",re.sub(r"\([^)]*\)","",folder.name)).strip(),"height":bool(height),"cloud":bool(cloud),"roughness":bool(roughness),"invertRoughness":bool(roughness and ("specular" in roughness.name.lower() or "metallic" in roughness.name.lower())),"emissive":bool(emissions)})
        print(f"Built {case_id}", flush=True)
    print("MANIFEST=" + repr(manifest)); print(f"Built {len(manifest)} planet cases")

if __name__ == "__main__": main()
