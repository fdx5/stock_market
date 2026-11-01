"""Pixel evidence and area constraints for floor plans; no templates or persistence."""
from __future__ import annotations

import math
import re

import cv2
import numpy as np


def enclosed_floor(wall: np.ndarray, bounds: tuple) -> np.ndarray:
    """Seal door-size gaps in a separate mask, then flood the exterior.

    Closing is used only for inside/outside classification. The original wall mask
    remains untouched for doors, windows, room separation and reconstruction.
    """
    x0, y0, x1, y1 = bounds
    gap = max(9, round(min(x1-x0, y1-y0)*.14))
    closed = cv2.morphologyEx(wall, cv2.MORPH_CLOSE, np.ones((1, gap), np.uint8))
    closed |= cv2.morphologyEx(wall, cv2.MORPH_CLOSE, np.ones((gap, 1), np.uint8))
    # Padding ensures that a wall touching an image edge cannot seed the flood.
    flood = cv2.copyMakeBorder(closed, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0)
    cv2.floodFill(flood, None, (0, 0), 255)
    inside = (flood[1:-1, 1:-1] == 0).astype(np.uint8)*255
    inside[:y0] = 0
    inside[y1+1:] = 0
    inside[:, :x0] = 0
    inside[:, x1+1:] = 0
    return inside


_AREA = re.compile(r"(?<![\d.])(\d{1,3}(?:[.,]\d{1,3})?)\s*(㎡|m[²2]|제곱미터|평)(?!\w)", re.I)


def read_areas(words: list[dict], bounds: tuple) -> list[dict]:
    """Use explicit units or decimal areas directly below a recognized room name.

    Older apartment plans omit ㎡ after every room area. A nearby semantic label
    and decimal point distinguish these numbers from dimensions and type IDs.
    """
    x0, y0, x1, y1 = bounds
    evidence = []
    for word in words:
        if word.get("rotation", 0) != 0:
            continue
        text = word["text"].replace("\u00a0", " ")
        candidates = [text]
        inferred_unit=False
        if re.fullmatch(r"\d{1,2}[.,]\d{1,3}",text.strip()):
            anchors=[a for a in words if a.get("rotation",0)==0 and any(t in a["text"] for t in ("침실","안방","거실","주방","식당","욕실","현관","발코니","드레스"))
                     and 0 < word["y"]-a["y"] < max(42,a.get("h",12)*3)
                     and abs(word["x"]-a["x"]) < max(32,a.get("w",20)*.65)]
            if anchors:
                candidates.append(text+'㎡');inferred_unit=True
        # Tesseract often emits the number and unit as separate words.
        if re.fullmatch(r"\d{1,3}(?:[.,]\d{1,3})?", text.strip()):
            right = word["x"] + word.get("w", 0)/2
            for unit in words:
                if unit.get("rotation", 0) or not re.fullmatch(r"㎡|m[²2]|제곱미터|평", unit["text"], re.I):
                    continue
                if abs(unit["y"]-word["y"]) <= max(5, word.get("h", 10)*.65) and -2 <= unit["x"]-unit.get("w", 0)/2-right <= max(12, word.get("h", 10)*1.5):
                    candidates.append(text+unit["text"])
        for candidate in candidates:
            match = _AREA.search(candidate)
            if not match:
                continue
            area = float(match[1].replace(",", "."))*(3.305785 if match[2] == "평" else 1)
            if not .3 <= area <= 999 or word.get("confidence", 0) < 40:
                continue
            scope = "supply" if "공급" in candidate else "exclusive" if "전용" in candidate else "room"
            if scope == "room" and not (x0 < word["x"] < x1 and y0 < word["y"] < y1):
                continue
            if any(abs(e["x"]-word["x"]) < 14 and abs(e["y"]-word["y"]) < 12 and abs(e["areaM2"]-area) < .02 for e in evidence):
                continue
            evidence.append({"text": text if inferred_unit else candidate, "areaM2": round(area, 4), "x": word["x"], "y": word["y"], "confidence": word["confidence"], "scope": scope,"unitBasis":"room_label_decimal" if inferred_unit else "explicit_unit"})
    return evidence


def fit_area_scale(evidence: list[dict], cells: dict, assigned: dict, seeds: list,
                   xs: list, ys: list, exclusive_area: float) -> tuple[float, list[dict], bool]:
    """One isotropic scale fits measured room areas, preserving source aspect ratios.

    Room areas constrain complete zones, including their L-shaped pieces. Individual
    rooms are never stretched independently. Contradictory labels are not averaged
    into a plausible-looking apartment.
    """
    zone_pixels = {}
    groups={z:seed.get("areaGroup",z) for z,seed in enumerate(seeds)}
    for (i, j), zone in assigned.items():
        group=groups[zone]
        zone_pixels[group] = zone_pixels.get(group, 0)+(xs[i+1]-xs[i])*(ys[j+1]-ys[j])
    counted = sum((xs[i+1]-xs[i])*(ys[j+1]-ys[j]) for (i,j),z in assigned.items() if seeds[z]["type"] not in ("balcony", "utility"))
    fallback = math.sqrt(exclusive_area/max(1, counted))
    observations = []
    for item in evidence:
        if item["scope"] != "room":
            continue
        c = next((c for c in cells if xs[c[0]] <= item["x"] <= xs[c[0]+1] and ys[c[1]] <= item["y"] <= ys[c[1]+1]), None)
        if c not in assigned:
            continue
        zone = groups[assigned[c]]
        # A whole-flat area printed inside the flat is not a room constraint.
        if item["areaM2"] >= exclusive_area*.9 or not zone_pixels.get(zone):
            continue
        observations.append({**item, "zone": zone, "pixelArea": zone_pixels[zone], "metresPerPixel": math.sqrt(item["areaM2"]/zone_pixels[zone])})
    if not observations:
        return fallback, [], False
    # Repeated OCR passes are not independent evidence.
    independent = {}
    for item in observations:
        prior = independent.get(item["zone"])
        if prior is None or item["confidence"] > prior["confidence"]:
            independent[item["zone"]] = item
    scales = sorted(i["metresPerPixel"] for i in independent.values())
    # Minimize relative area errors in log space, so a large living room cannot
    # overwhelm a smaller bedroom. All independent rooms contribute equally.
    scale = math.exp(sum(math.log(s) for s in scales)/len(scales))
    for item in observations:
        item["relativeResidual"] = round(abs(item["pixelArea"]*scale*scale-item["areaM2"])/item["areaM2"], 4)
    conflict = any(i["relativeResidual"] > .15 for i in observations) or not .7 < scale/fallback < 1.4
    return scale, observations, conflict


def source_match(wall: np.ndarray, rooms: list[dict], openings: list[dict], xs: list,
                 ys: list, rectangles: list, bounds: tuple, source_floor:np.ndarray|None=None) -> dict:
    """Compare reconstructed structural boundaries with detected source wall pixels.

    This is a geometric consistency measurement, not calibrated recognition accuracy.
    It cannot certify semantic labels, scale or an unseen wall under a watermark.
    """
    x0, y0, x1, y1 = bounds
    predicted = np.zeros_like(wall)
    floor=np.zeros_like(wall)
    for r in rectangles:
        i, j, right, bottom = r["grid"]
        cv2.rectangle(predicted, (round(xs[i]), round(ys[j])), (round(xs[right]), round(ys[bottom])), 255, 1)
        cv2.rectangle(floor,(round(xs[i]),round(ys[j])),(round(xs[right]),round(ys[bottom])),255,-1)
    # Decomposition seams and observed open connections are not structural walls.
    by_id = {r["id"]: index for index, r in enumerate(rooms)}
    # Coordinates are linear or piecewise calibrated; invert via rectangle endpoints.
    def pixel(value, axis):
        pairs = sorted({(r["rect"][axis], (xs if axis == 0 else ys)[r["grid"][axis]]) for r in rectangles} |
                       {(r["rect"][axis+2], (xs if axis == 0 else ys)[r["grid"][axis+2]]) for r in rectangles})
        return round(float(np.interp(value, [p[0] for p in pairs], [p[1] for p in pairs])))
    for opening in openings:
        if opening["type"] not in ("open", "door", "sliding_door") or opening["a"] not in by_id:
            continue
        axis = 0 if opening["axis"] == "x" else 1
        at = pixel(opening["at"], axis)
        lo = pixel(opening["center"]-opening["width"]/2, 1-axis)
        hi = pixel(opening["center"]+opening["width"]/2, 1-axis)
        if axis == 0:
            predicted[max(0, lo+1):hi, max(0, at-1):at+2] = 0
        else:
            predicted[max(0, at-1):at+2, max(0, lo+1):hi] = 0
    tolerance = max(3, round(min(x1-x0, y1-y0)*.008))
    kernel = np.ones((2*tolerance+1, 2*tolerance+1), np.uint8)
    # Compare centre lines with centre lines. Comparing a 1px projection with all
    # ink in a 12px wall would report false errors solely from stroke thickness.
    skeleton=np.zeros_like(wall);remaining=wall.copy()
    cross=cv2.getStructuringElement(cv2.MORPH_CROSS,(3,3))
    for _ in range(64):
        if not cv2.countNonZero(remaining):break
        eroded=cv2.erode(remaining,cross,borderType=cv2.BORDER_CONSTANT,borderValue=0)
        skeleton|=cv2.subtract(remaining,cv2.dilate(eroded,cross))
        remaining=eroded
    # Bound work for malformed solid masks as well as ordinary 2–12px strokes.
    if cv2.countNonZero(remaining):skeleton|=remaining
    # Source images can include common stairwells outside the selected apartment.
    # Compare the unit's walls, and independently check source floor coverage so
    # omitting a coloured room cannot improve the wall score by reducing its scope.
    scope=cv2.dilate(floor,kernel)>0
    observed = (skeleton[y0:y1+1, x0:x1+1] > 0)&scope[y0:y1+1,x0:x1+1]
    projected = predicted[y0:y1+1, x0:x1+1] > 0
    near_projection = cv2.dilate(predicted, kernel)[y0:y1+1, x0:x1+1] > 0
    near_observed = cv2.dilate(skeleton, kernel)[y0:y1+1, x0:x1+1] > 0
    recall = float((observed & near_projection).sum()/max(1, observed.sum()))
    precision = float((projected & near_observed).sum()/max(1, projected.sum()))
    f1 = 2*precision*recall/max(1e-9, precision+recall)
    coverage=None
    if source_floor is not None:
        coverage=float(((floor>0)&source_floor).sum()/max(1,source_floor.sum()))
    return {"wallRecall": round(recall, 4), "wallPrecision": round(precision, 4), "wallF1": round(f1, 4), "tolerancePixels": tolerance,
            "floorCoverage":round(coverage,4) if coverage is not None else None,
            "target": .95, "targetMet": f1 >= .95 and (coverage is None or coverage>=.95), "scope":"reconstructed_unit_and_source_floor_coverage",
            "metric": "unit_wall_centerline_f1", "certifiedAccuracy": False}
