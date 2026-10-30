"""Free, local image-to-numbers pipeline (OpenCV + Tesseract, no metered AI call).

Output is an image interpretation, never a claim of an as-built survey. Source pixels,
recognized dimension evidence and scale provenance accompany every result. Unknown or
unreadable drawings return needs_review rather than a made-up standard flat.
"""
from __future__ import annotations

import csv
import heapq
import io
import math
import shutil
import subprocess
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

cv2.setNumThreads(1)
VERSION = "orthogonal-ocr-4"


def _ocr(image: np.ndarray, rotation: int = 0, mode: str = "mixed") -> list[dict]:
    command = shutil.which("tesseract")
    if not command:
        return []
    if rotation:
        image = cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    scaled = cv2.resize(image, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    encoded = cv2.imencode(".png", scaled)[1].tobytes()
    try:
        model_dir=Path(__file__).resolve().parents[1]/"assets"/"floorplan-ocr"
        args=[command, "stdin", "stdout", "--tessdata-dir", str(model_dir), "-l", "kor" if mode=="text" else "eng" if rotation or mode=="digits" else "kor+eng", "--oem", "1", "--psm", "6" if mode=="text" else "11"]
        if rotation or mode=="digits":args.extend(["-c","tessedit_char_whitelist=0123456789"])
        # Select TSV through parameters: a custom model directory need not contain
        # the operating system's `configs/tsv` file.
        result = subprocess.run(args+["-c","tessedit_create_tsv=1","-c","tessedit_create_txt=0"],
                                input=encoded, capture_output=True, timeout=12, check=True)
    except (subprocess.SubprocessError, OSError):
        return []
    out = []
    for row in csv.DictReader(io.StringIO(result.stdout.decode("utf8", "replace")), delimiter="\t"):
        try:
            if row["level"] != "5" or float(row["conf"]) < 25 or not row["text"].strip():
                continue
            x, y, w, h = [float(row[k]) / 3 for k in ("left", "top", "width", "height")]
            cx, cy = x + w / 2, y + h / 2
            if rotation:
                cx, cy = cy, image.shape[1] - cx
                w, h = h, w
            out.append({"text": row["text"].strip(), "x": cx, "y": cy, "w": w, "h": h,
                        "confidence": float(row["conf"]), "rotation": rotation})
        except (ValueError, KeyError):
            continue
    return out


def _room_ocr(mask: np.ndarray, bounds: tuple[int,int,int,int], locate: np.ndarray | None = None) -> list[dict]:
    """Read enlarged text patches without the drawing's walls, floor or dimension chains.

    A single Korean-only OCR pass over the patch sheet replaces dozens of per-room calls.
    Every recognized word is mapped back into the original image coordinate system.
    """
    x0,y0,x1,y1=bounds
    interior=(locate if locate is not None else mask).copy();interior[:y0+5]=0;interior[y1-4:]=0;interior[:,:x0+5]=0;interior[:,x1-4:]=0
    joined=cv2.morphologyEx(interior,cv2.MORPH_CLOSE,np.ones((3,9),np.uint8))
    contours,_=cv2.findContours(joined,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    patches=[]
    for contour in contours:
        x,y,w,h=cv2.boundingRect(contour)
        if not (12<=w<=130 and 7<=h<=28 and .65<w/h<11):continue
        ink=float((interior[y:y+h,x:x+w]>0).mean())
        if not .06<ink<.75:continue
        patches.append((max(0,x-3),max(0,y-3),min(mask.shape[1],x+w+3),min(mask.shape[0],y+h+3)))
    patches.sort(key=lambda r:(r[1],r[0]));patches=patches[:64]
    if not patches:return []
    width=max((r[2]-r[0])*2 for r in patches)+32
    height=sum((r[3]-r[1])*2+28 for r in patches)
    sheet=np.full((height,width),255,np.uint8);positions=[];cursor=0
    for x,y,r,b in patches:
        crop=255-mask[y:b,x:r];crop=cv2.resize(crop,None,fx=2,fy=2,interpolation=cv2.INTER_CUBIC)
        sheet[cursor+12:cursor+12+crop.shape[0],16:16+crop.shape[1]]=crop
        positions.append((cursor+12,cursor+12+crop.shape[0],x,y,r,b));cursor+=crop.shape[0]+28
    words=[]
    for word in _ocr(sheet,mode="text"):
        patch=next((p for p in positions if p[0]-4<=word["y"]<=p[1]+4),None)
        if not patch:continue
        top,_,x,y,r,b=patch
        words.append({**word,"x":x+(word["x"]-16)/2,"y":y+(word["y"]-top)/2,"w":word["w"]/2,"h":word["h"]/2,"rotation":0})
    return words


def _clusters(values: list[float], tolerance: float = 7) -> list[float]:
    groups: list[list[float]] = []
    for value in sorted(values):
        if groups and value - np.mean(groups[-1]) < tolerance:
            groups[-1].append(value)
        else:
            groups.append([value])
    return [round(float(np.mean(g)), 2) for g in groups]


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    padded = np.r_[False, mask.astype(bool), False].astype(np.int8)
    changes = np.diff(padded)
    return list(zip(np.where(changes == 1)[0].tolist(), np.where(changes == -1)[0].tolist()))


def _dimension_scale(dimension: dict | None, gray: np.ndarray, axis: str, bounds: tuple[int,int,int,int]) -> float | None:
    """Calibrate from the dimension line's own endpoints, not the drawing's bounding box.

    A projecting balcony makes those spans different. Using the bbox shrank 154-type
    doorways even when the OCR millimetre value was correct.
    """
    if not dimension:return None
    x0,y0,x1,y1=bounds
    image=gray if axis=="x" else gray.T
    along=dimension["x"] if axis=="x" else dimension["y"]
    across=dimension["y"] if axis=="x" else dimension["x"]
    near,far=(y0,y1) if axis=="x" else (x0,x1)
    span=(x1-x0) if axis=="x" else (y1-y0)
    ink=(image<225).astype(np.uint8)*255
    lines=cv2.morphologyEx(ink,cv2.MORPH_CLOSE,np.ones((1,5),np.uint8))
    lines=cv2.morphologyEx(lines,cv2.MORPH_OPEN,np.ones((1,max(40,round(span*.4))),np.uint8))
    candidates=[]
    for row in range(max(0,round(across)-28),min(image.shape[0],round(across)+29)):
        if near-4<row<far+4:continue
        for start,end in _runs(lines[row]>0):
            if start+8<along<end-8 and end-start>span*.4:
                candidates.append((abs(row-across),-(end-start),start,end,row))
    if not candidates:return None
    _,_,start,end,row=min(candidates)
    dimension["dimensionLine"]={"axis":axis,"atPixel":row,"startPixel":start,"endPixel":end-1}
    return dimension["millimetres"]/1000/max(1,end-1-start)


def _axis_calibration(dimensions: list[dict], gray: np.ndarray, axis: str, bounds: tuple[int,int,int,int], fallback: float):
    """Fit monotone metre coordinates to observed dimension-chain tick pairs.

    Several opposing chains can be slightly inconsistent. A regularized fit combines
    them and rejects OCR outliers; it never substitutes an architectural template.
    """
    x0,y0,x1,y1=bounds;image=gray if axis=="x" else gray.T
    near,far=(y0,y1) if axis=="x" else (x0,x1)
    frame_start=x0 if axis=="x" else y0;frame_end=x1 if axis=="x" else y1
    ink=(image<225).astype(np.uint8)*255
    lines=cv2.morphologyEx(ink,cv2.MORPH_CLOSE,np.ones((1,5),np.uint8))
    lines=cv2.morphologyEx(lines,cv2.MORPH_OPEN,np.ones((1,max(40,round((frame_end-frame_start)*.4))),np.uint8))
    constraints=[]
    for d in dimensions:
        if d.get("rotation",0)!=(0 if axis=="x" else 90):continue
        along=d["x"] if axis=="x" else d["y"];across=d["y"] if axis=="x" else d["x"]
        if near-8<across<far+8:continue
        candidates=[]
        for row in range(max(0,round(across)-25),min(image.shape[0],round(across)+26)):
            if near-4<row<far+4:continue
            for lo,hi in _runs(lines[row]>0):
                if lo+5<along<hi-5:candidates.append((abs(row-across),-(hi-lo),lo,hi,row))
        if not candidates:continue
        plausible=[]
        for _,_,lo,hi,row in sorted(candidates):
            tick_counts=(ink[max(0,row-6):row+7,lo:hi]>0).sum(axis=0)
            ticks=_clusters([lo+(a+b-1)/2 for a,b in _runs(tick_counts>=4)],3)
            ticks=_clusters([float(lo),float(hi-1),*ticks],3)
            left=max((v for v in ticks if v<along-3),default=None);right=min((v for v in ticks if v>along+3),default=None)
            if left is None or right is None or right-left<12:continue
            if abs(along-(left+right)/2)>(right-left)*.32:continue
            metres=d["millimetres"]/1000;ratio=metres/(right-left)
            if not .6*fallback<ratio<1.5*fallback:continue
            plausible.append((abs(row-across)+45*abs(math.log(ratio/fallback)),{"axis":axis,"startPixel":left,"endPixel":right,"metres":metres,"confidence":d["confidence"]}))
        if plausible:constraints.append(min(plausible,key=lambda p:p[0])[1])
    def linear(v):return float((v-frame_start)*fallback)
    if len(constraints)<3:return linear,[]
    nodes=_clusters([p for c in constraints for p in (c["startPixel"],c["endPixel"])],3)
    if len(nodes)>64 or nodes[-1]-nodes[0]<(frame_end-frame_start)*.6:return linear,[]
    A=[];b=[]
    for c in constraints:
        i=min(range(len(nodes)),key=lambda i:abs(nodes[i]-c["startPixel"]));j=min(range(len(nodes)),key=lambda i:abs(nodes[i]-c["endPixel"]))
        if i==j:continue
        weight=max(.35,c["confidence"]/100)/math.sqrt(max(.5,c["metres"]))
        row=np.zeros(len(nodes));row[i]=-weight;row[j]=weight;A.append(row);b.append(c["metres"]*weight)
    for i in range(len(nodes)-1):
        row=np.zeros(len(nodes));row[i]=-.18;row[i+1]=.18;A.append(row);b.append((nodes[i+1]-nodes[i])*fallback*.18)
    row=np.zeros(len(nodes));row[0]=100;A.append(row);b.append(0)
    values=np.linalg.lstsq(np.asarray(A),np.asarray(b),rcond=None)[0]
    slopes=np.diff(values)/np.diff(nodes)
    if np.any(slopes<.35*fallback) or np.any(slopes>2*fallback):return linear,[]
    residuals=[abs(float(np.interp(c["endPixel"],nodes,values)-np.interp(c["startPixel"],nodes,values))-c["metres"])/max(.2,c["metres"]) for c in constraints]
    if float(np.median(residuals))>.1:return linear,[]
    def raw(v):
        if v<nodes[0]:return float(values[0]+(v-nodes[0])*slopes[0])
        if v>nodes[-1]:return float(values[-1]+(v-nodes[-1])*slopes[-1])
        return float(np.interp(v,nodes,values))
    origin=raw(frame_start)
    return lambda v:raw(v)-origin,[{**c,"relativeResidual":round(r,4)} for c,r in zip(constraints,residuals)]


def _phrases(words: list[dict]) -> list[dict]:
    # Korean OCR can emit one syllable per word (주 / 방 / 식 / 당). Rejoin nearby
    # syllables on one baseline before matching room names, retaining their position.
    groups: list[list[dict]] = []
    for word in sorted((w for w in words if w.get("rotation",0)==0),key=lambda w:(w["y"],w["x"])):
        group=next((g for g in groups if abs(np.mean([w["y"] for w in g])-word["y"])<8 and min(abs(w["x"]-word["x"]) for w in g)<45),None)
        if group is None:groups.append([word])
        else:group.append(word)
    result=list(words)
    for group in groups:
        if len(group)<2:continue
        group.sort(key=lambda w:w["x"])
        result.append({**group[0],"text":"".join(w["text"] for w in group),"x":float(np.mean([w["x"] for w in group])),"y":float(np.mean([w["y"] for w in group]))})
    return result


def analyze_image(data: bytes, exclusive_area: float, *, words: list[dict] | None = None) -> dict:
    started = time.perf_counter()
    # Inspect dimensions before allocating/decompressing the image. No on-disk source files.
    with Image.open(io.BytesIO(data)) as source:
        if source.width * source.height > 4_000_000 or min(source.size) < 200:
            return {"status": "needs_review", "reason": "image_dimensions", "version": VERSION}
        if "A" in source.getbands() or "transparency" in source.info:
            background=Image.new("RGBA",source.size,"white")
            background.alpha_composite(source.convert("RGBA"))
            rgb=np.asarray(background.convert("RGB"))
        else:
            rgb = np.asarray(source.convert("RGB"))
    im = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    H, W = im.shape[:2]
    gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    dark = (gray < 75).astype(np.uint8) * 255
    # Door leaves are thin strokes, often drawn exactly along the wall's axis.
    # Treating their 2–3 px line as a structural wall erased the real doorway.
    wall_kernel=5 if min(H,W)>=600 else 3
    thick = cv2.morphologyEx(dark, cv2.MORPH_OPEN, np.ones((wall_kernel, wall_kernel), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(thick)
    ids = [i for i in range(1, n) if stats[i, 4] > 100 and max(stats[i, 2:4]) > min(H, W) * .08]
    points = np.argwhere(np.isin(labels, ids))
    if len(points) < 500:
        return {"status": "needs_review", "reason": "wall_detection", "version": VERSION}
    y0, x0 = points.min(0).astype(int)
    y1, x1 = points.max(0).astype(int)
    if x1 - x0 < W * .25 or y1 - y0 < H * .25:
        return {"status": "needs_review", "reason": "outline_detection", "version": VERSION}
    # Thin, neutral window frames count as barriers, coloured wood grain does not.
    neutral = (((im.max(2) - im.min(2) < 45) & (gray < 210)) | (gray < 65)).astype(np.uint8) * 255
    minimum = max(20, round(min(x1 - x0, y1 - y0) * .055))
    horizontal = cv2.morphologyEx(thick, cv2.MORPH_OPEN, np.ones((1, minimum), np.uint8))
    vertical = cv2.morphologyEx(thick, cv2.MORPH_OPEN, np.ones((minimum, 1), np.uint8))
    # Long thin framing near the perimeter is glazing. Thin furniture/sanitary outlines
    # in the middle of a room must not turn into full-height interior partitions.
    weak_h = cv2.morphologyEx(neutral, cv2.MORPH_OPEN, np.ones((1, max(minimum,round((x1-x0)*.17))), np.uint8))
    weak_v = cv2.morphologyEx(neutral, cv2.MORPH_OPEN, np.ones((max(minimum,round((y1-y0)*.22)), 1), np.uint8))
    weak_h[round(y0+(y1-y0)*.2):round(y1-(y1-y0)*.2)] = 0
    weak_v[:,round(x0+(x1-x0)*.2):round(x1-(x1-x0)*.2)] = 0
    # A bathroom's thin closed door leaf may continue a bold wall into one long
    # neutral line. It is not perimeter glazing: adding that weak line sealed the
    # Desiang bathroom doorway even after the structural stroke was removed.
    wet_hsv=cv2.cvtColor(im,cv2.COLOR_BGR2HSV)
    blue=(wet_hsv[:,:,0]>75)&(wet_hsv[:,:,0]<115)&(wet_hsv[:,:,1]>15)
    for weak in [weak_h,weak_v]:
        contours,_=cv2.findContours(weak,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            x,y,w,h=cv2.boundingRect(contour)
            adjacent=blue[max(0,y-12):min(H,y+h+12),max(0,x-25):min(W,x+w+25)]
            if adjacent.size and adjacent.mean()>.025:weak[y:y+h,x:x+w]=0
    horizontal |= weak_h
    vertical |= weak_v
    wall = horizontal | vertical
    structural=thick[y0:y1+1,x0:x1+1]>0
    axis_covered=cv2.dilate(wall,np.ones((3,3),np.uint8))[y0:y1+1,x0:x1+1]>0
    if structural.sum() and (structural&axis_covered).sum()/structural.sum()<.70:
        return {"status":"needs_review","reason":"non_orthogonal_walls","version":VERSION}
    # Remove long lines only in the OCR copy. The geometry always uses source pixels.
    # A translucent white watermark raises a black label's grey level. A hard <75
    # threshold erased strokes (e.g. 거 -> ㄱ). Retain neutral, dark-grey text too,
    # while excluding the saturated timber floor behind it.
    ocr_mask=(((gray<155)&(im.max(2)-im.min(2)<70))|(gray<75)).astype(np.uint8)*255
    if words is None:
        number_lines=cv2.morphologyEx(dark,cv2.MORPH_OPEN,np.ones((1,35),np.uint8))|cv2.morphologyEx(dark,cv2.MORPH_OPEN,np.ones((35,1),np.uint8))
        number_mask=dark.copy();number_mask[cv2.dilate(number_lines,np.ones((3,3),np.uint8))>0]=0
        room_words=_room_ocr(number_mask,(x0,y0,x1,y1))
        texts=[w["text"] for w in _phrases(room_words)]
        if not all(any(any(term in text for term in group) for text in texts) for group in [("거실",),("주방","식당"),("침실","짐실","안방")]):
            # Keep the crisp black-text pass and recover watermark-covered grey strokes
            # with a second observation, rather than discarding one pass's good labels.
            recovery=ocr_mask.copy()
            recovery_lines=cv2.morphologyEx(recovery,cv2.MORPH_OPEN,np.ones((1,80),np.uint8))|cv2.morphologyEx(recovery,cv2.MORPH_OPEN,np.ones((45,1),np.uint8))
            recovery[cv2.dilate(recovery_lines,np.ones((3,3),np.uint8))>0]=0
            room_words+=_room_ocr(recovery,(x0,y0,x1,y1))
        number_mask[max(0,y0-3):y1+4,max(0,x0-3):x1+4]=0
        words = room_words + _ocr(255-number_mask,mode="digits") + _ocr(255-number_mask,90,mode="digits")
    words = _phrases(words)
    numeric = []
    for word in words:
        text = word["text"].replace(",", "").strip(" .|[]")
        if text.isdigit() and 200 <= int(text) <= 30000 and int(text)%5==0:
            numeric.append({**word, "millimetres": int(text)})
    xdim = [d for d in numeric if d.get("rotation", 0) == 0 and (d["y"] < y0 - 15 or d["y"] > y1 + 15) and x0 < d["x"] < x1]
    ydim = [d for d in numeric if d.get("rotation", 0) == 90 and (d["x"] < x0 - 15 or d["x"] > x1 + 15) and y0 < d["y"] < y1]
    # Overall bottom width is preferred over a top chain which may exclude a projecting bay.
    bottom = [d for d in xdim if d["y"] > y1]
    dx = max(bottom or xdim, key=lambda d: d["millimetres"], default=None)
    dy = max(ydim, key=lambda d: d["millimetres"], default=None)
    default_scale = math.sqrt(exclusive_area * 1.20 / ((x1 - x0) * (y1 - y0)))
    # Newer drawings often show only adjacent segment dimensions, with no total.
    # Fit those tick chains first using area solely as a plausibility prior. Dividing
    # the largest *segment* by the whole baseline shrank Desiang plans to 13% area.
    X,x_constraints=_axis_calibration(numeric,gray,"x",(x0,y0,x1,y1),default_scale)
    Z,z_constraints=_axis_calibration(numeric,gray,"z",(x0,y0,x1,y1),default_scale)
    chain_applied=bool(x_constraints and z_constraints)
    if chain_applied:
        sx,sy=(X(x1)-X(x0))/(x1-x0),(Z(y1)-Z(y0))/(y1-y0)
        dimension_scale=True
    else:
        sx = (_dimension_scale(dx,gray,"x",(x0,y0,x1,y1)) or dx["millimetres"]/1000/(x1-x0)) if dx else None
        sy = (_dimension_scale(dy,gray,"z",(x0,y0,x1,y1)) or dy["millimetres"]/1000/(y1-y0)) if dy else None
        if x_constraints:sx=(X(x1)-X(x0))/(x1-x0)
        if z_constraints:sy=(Z(y1)-Z(y0))/(y1-y0)
        dimension_scale=sx is not None and sy is not None
        if sx and sy and not .65<sx/sy<1.55:
            return {"status":"needs_review","reason":"dimension_conflict","version":VERSION}
        sx,sy=sx or sy or default_scale,sy or sx or default_scale
        X=lambda v:float((v-x0)*sx)
        Z=lambda v:float((v-y0)*sy)
    xs: list[float] = [float(x0), float(x1)]
    ys: list[float] = [float(y0), float(y1)]
    for axis, mask in [("x", vertical), ("y", horizontal)]:
        contours, _ = cv2.findContours(mask[y0:y1+1, x0:x1+1], cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            if axis == "x" and h > minimum * 1.5 and w < 15:
                xs.append(x0 + x + (w - 1) / 2)
            if axis == "y" and w > minimum * 1.5 and h < 15:
                ys.append(y0 + y + (h - 1) / 2)
    xs, ys = _clusters(xs), _clusters(ys)
    # Discard drawing details too narrow to be a usable floor cell, retaining actual outer limits.
    def usable(axis: list[float], scale: float) -> list[float]:
        result = [axis[0]]
        for v in axis[1:-1]:
            if (v - result[-1]) * scale >= .18 and (axis[-1] - v) * scale >= .18:
                result.append(v)
        return result + [axis[-1]]
    xs, ys = usable(xs, sx), usable(ys, sy)
    if len(xs) > 35 or len(ys) > 35:
        return {"status": "needs_review", "reason": "non_orthogonal_or_complex", "version": VERSION}
    nx, ny = len(xs) - 1, len(ys) - 1
    hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
    cells: dict[tuple[int, int], dict] = {}
    for j in range(ny):
        for i in range(nx):
            a, b, c, d = round(xs[i])+3, round(ys[j])+3, round(xs[i+1])-3, round(ys[j+1])-3
            if c <= a or d <= b:
                continue
            patch = hsv[b:d, a:c]
            # A white recess outside the drawn outline is not a room. Neutral grey service
            # rooms and the checkered entrance are retained by their non-white pixels.
            occupied = ((patch[:, :, 1] > 15) | (patch[:, :, 2] < 232)).mean()
            if occupied < .12:
                continue
            cells[i, j] = {"center": ((xs[i]+xs[i+1])/2, (ys[j]+ys[j+1])/2),
                           "blue":float(((patch[:,:,0]>75)&(patch[:,:,0]<115)&(patch[:,:,1]>15)).mean()),
                           "wood":float(((patch[:,:,0]>8)&(patch[:,:,0]<40)&(patch[:,:,1]>85)).mean()),
                           "pale":float(((patch[:,:,0]>10)&(patch[:,:,0]<40)&(patch[:,:,1]>15)&(patch[:,:,1]<100)&(patch[:,:,2]>190)).mean())}
    if not cells:
        return {"status": "needs_review", "reason": "floor_detection", "version": VERSION}

    def barrier(a: tuple[int, int], b: tuple[int, int]) -> tuple[float, list[tuple[float, float]]]:
        i, j = a
        vertical_edge = a[0] != b[0]
        at = round(xs[max(i, b[0])]) if vertical_edge else round(ys[max(j, b[1])])
        lo, hi = (ys[j], ys[j+1]) if vertical_edge else (xs[i], xs[i+1])
        l, h = round(lo)+3, round(hi)-3
        if h <= l:
            return 1, []
        sample = wall[l:h, max(0,at-3):at+4] if vertical_edge else wall[max(0,at-3):at+4, l:h]
        solid = sample.max(axis=1 if vertical_edge else 0) > 0
        gaps = [(l+a, l+b) for a, b in _runs(~solid)]
        return float(solid.mean()), gaps

    neighbours: dict[tuple[int, int], list[tuple[tuple[int, int], float]]] = {c: [] for c in cells}
    for c in cells:
        for q in [(c[0]+1,c[1]), (c[0]-1,c[1]), (c[0],c[1]+1), (c[0],c[1]-1)]:
            if q not in cells:
                continue
            coverage, _ = barrier(c,q)
            pc, pq = cells[c]["center"], cells[q]["center"]
            neighbours[c].append((q, math.hypot((pc[0]-pq[0])*sx,(pc[1]-pq[1])*sy) + (100 if coverage > .13 else 0)))

    seeds = []
    room_patterns = [("kitchen", ("주방", "식당")), ("living", ("거실",)), ("bedroom", ("침실", "짐실", "안방")),
                     ("bathroom", ("욕실", "화장실")), ("balcony", ("발코니", "베란다")), ("entrance", ("현관",)), ("dressroom", ("드레스",))]
    for word in words:
        if word.get("rotation",0) != 0 or not (x0 < word["x"] < x1 and y0 < word["y"] < y1):
            continue
        kind = next((kind for kind, patterns in room_patterns if any(p in word["text"] for p in patterns)), None)
        if not kind:
            continue
        seed_cell = min(cells, key=lambda c: math.dist(cells[c]["center"], (word["x"],word["y"])))
        if any(s["cell"] == seed_cell and s["type"] == kind for s in seeds):
            continue
        seeds.append({"cell": seed_cell, "type": kind, "label": word["text"], "observed": True})
    kinds = {s["type"] for s in seeds}
    if not {"living", "kitchen", "bedroom"}.issubset(kinds):
        return {"status": "needs_review", "reason": "room_labels", "version": VERSION,
                "recognizedDimensions": numeric, "recognizedRoomTypes": sorted(kinds), "elapsedMs": round((time.perf_counter()-started)*1000)}
    # Some labels are covered by an upstream watermark. Distinct pale bedroom floor
    # fills can supply an explicitly inferred seed; their walls still come from pixels.
    pale = ((hsv[:,:,0]>10)&(hsv[:,:,0]<40)&(hsv[:,:,1]>15)&(hsv[:,:,1]<100)&(hsv[:,:,2]>190)).astype(np.uint8)*255
    pale[:y0]=0;pale[y1:]=0;pale[:,:x0]=0;pale[:,x1:]=0
    pale=cv2.morphologyEx(pale,cv2.MORPH_CLOSE,np.ones((9,9),np.uint8))
    pale[cv2.dilate(wall,np.ones((3,3),np.uint8))>0]=0
    pn,pl,ps,pc=cv2.connectedComponentsWithStats(pale)
    for k in range(1,pn):
        x,y,w,h,area=ps[k]
        if area*sx*sy<3.5 or area<.72*w*h or not .35<w/max(1,h)<3:
            continue
        if any(x<=cells[s["cell"]]["center"][0]<=x+w and y<=cells[s["cell"]]["center"][1]<=y+h for s in seeds):
            continue
        center=pc[k];seed_cell=min(cells,key=lambda c:math.dist(cells[c]["center"],center))
        if not any(s["cell"]==seed_cell for s in seeds):
            seeds.append({"cell":seed_cell,"type":"bedroom","label":"침실 (바닥 영역 인식)","observed":False})
    # Bathroom tile fill is an explicit visual inference when its label is occluded by fixtures.
    bath_mask=blue.astype(np.uint8)*255
    bath_mask[:y0]=0;bath_mask[y1:]=0;bath_mask[:,:x0]=0;bath_mask[:,x1:]=0
    bath_mask=cv2.morphologyEx(bath_mask,cv2.MORPH_CLOSE,np.ones((9,9),np.uint8))
    bn,bl,bs,bc=cv2.connectedComponentsWithStats(bath_mask)
    for k in sorted(range(1,bn),key=lambda k:-bs[k,4])[:6]:
        x,y,w,h,area=bs[k]
        if area*sx*sy<.35 or not .2<w/max(1,h)<5:continue
        if any(s["type"]=="bathroom" and x-8<=cells[s["cell"]]["center"][0]<=x+w+8 and y-8<=cells[s["cell"]]["center"][1]<=y+h+8 for s in seeds):continue
        candidates=[c for c in cells if cells[c]["blue"]>.05 and x-5<=cells[c]["center"][0]<=x+w+5 and y-5<=cells[c]["center"][1]<=y+h+5]
        if candidates:
            seed_cell=min(candidates,key=lambda c:math.dist(cells[c]["center"],bc[k]))
            if not any(s["cell"]==seed_cell for s in seeds):seeds.append({"cell":seed_cell,"type":"bathroom","label":"욕실 (색상 인식)","observed":False})
    # Multi-source geodesic assignment respects observed walls instead of picking a template.
    assigned, distances, queue = {}, {}, []
    for index, seed in enumerate(seeds):
        c=seed["cell"];assigned[c]=index;distances[c]=0.;heapq.heappush(queue,(0.,index,c))
    while queue:
        distance,index,c=heapq.heappop(queue)
        if distance>distances.get(c,float("inf"))+.001 or assigned.get(c)!=index:
            continue
        for q,cost in neighbours[c]:
            feature=cells[q];kind=seeds[index]["type"]
            mismatch=500 if kind=="bathroom" and feature["blue"]<.05 else 200 if kind=="balcony" and feature["wood"]>.4 else 150 if kind in ("living","kitchen") and feature["pale"]>.5 else 150 if kind=="bedroom" and (feature["wood"]>.45 or feature["blue"]>.25) else 0
            nd=distance+cost+mismatch
            if nd<distances.get(q,float("inf")):
                distances[q]=nd;assigned[q]=index;heapq.heappush(queue,(nd,index,q))
    # Merge adjacent cells only across a wall-free edge and within one observed room zone.
    consumed=set();rectangles=[];cell_room={}
    for j in range(ny):
        for i in range(nx):
            c=(i,j)
            if c not in cells or c in consumed or c not in assigned:
                continue
            index=assigned[c];limit=i+1
            while (limit,j) in cells and (limit,j) not in consumed and assigned.get((limit,j))==index and barrier((limit-1,j),(limit,j))[0]<.10:
                limit+=1
            # The largest inscribed rectangle furnishes an L-shaped room better than
            # always taking the widest, shallowest strip first. Never merge through a wall.
            best=(-1.,i+1,j+1)
            for right_candidate in range(i+1,limit+1):
                bottom_candidate=j+1
                while bottom_candidate<ny and all((k,bottom_candidate) in cells and (k,bottom_candidate) not in consumed and assigned.get((k,bottom_candidate))==index and barrier((k,bottom_candidate-1),(k,bottom_candidate))[0]<.10 and (k==i or barrier((k-1,bottom_candidate),(k,bottom_candidate))[0]<.10) for k in range(i,right_candidate)):
                    bottom_candidate+=1
                candidate_area=(xs[right_candidate]-xs[i])*(ys[bottom_candidate]-ys[j])
                if candidate_area>best[0]:best=(candidate_area,right_candidate,bottom_candidate)
            _,right,bottom=best
            rid=len(rectangles)
            for yy in range(j,bottom):
                for xx in range(i,right):
                    consumed.add((xx,yy));cell_room[xx,yy]=rid
            rectangles.append({"zone":index,"grid":[i,j,right,bottom],"rect":[X(xs[i]),Z(ys[j]),X(xs[right]),Z(ys[bottom])]})
    # Adjacent decomposition rectangles can share a fully open edge despite a few
    # glyph pixels. Merge complete matching spans before selecting the furnished room;
    # otherwise a normal bedroom could be represented by a 1.1 m-deep lead strip.
    changed=True
    while changed:
        changed=False
        for a in range(len(rectangles)):
            if changed:break
            for b in range(a+1,len(rectangles)):
                ra,rb=rectangles[a],rectangles[b]
                if ra["zone"]!=rb["zone"]:continue
                i,j,r,d=ra["grid"];ii,jj,rr,dd=rb["grid"]
                if i==ii and r==rr and (d==jj or dd==j):
                    at=ys[d if d==jj else j];lo,hi=xs[i],xs[r];p=round(at)
                    sample=wall[max(0,p-3):p+4,round(lo):round(hi)]
                    coverage=float((sample.max(axis=0)>0).mean()) if sample.size else 1
                elif j==jj and d==dd and (r==ii or rr==i):
                    at=xs[r if r==ii else i];lo,hi=ys[j],ys[d];p=round(at)
                    sample=wall[round(lo):round(hi),max(0,p-3):p+4]
                    coverage=float((sample.max(axis=1)>0).mean()) if sample.size else 1
                else:continue
                if coverage>=.13:continue
                grid=[min(i,ii),min(j,jj),max(r,rr),max(d,dd)]
                ra["grid"]=grid;ra["rect"]=[X(xs[grid[0]]),Z(ys[grid[1]]),X(xs[grid[2]]),Z(ys[grid[3]])]
                rectangles.pop(b);changed=True;break
    cell_room={}
    for rid,r in enumerate(rectangles):
        i,j,right,bottom=r["grid"]
        for yy in range(j,bottom):
            for xx in range(i,right):cell_room[xx,yy]=rid
    if not rectangles or len(rectangles)>120:
        return {"status":"needs_review","reason":"partition_complexity","version":VERSION}
    # Only the largest rectangle in a zone receives room furniture; its other pieces retain
    # the same light zone and pass-through floor, avoiding duplicate beds in an L-shaped room.
    leads={}
    for rid,r in enumerate(rectangles):
        area=(r["rect"][2]-r["rect"][0])*(r["rect"][3]-r["rect"][1])
        if r["zone"] not in leads or area>leads[r["zone"]][0]:
            leads[r["zone"]]=(area,rid)
    bedrooms=[(a,rid,z) for z,(a,rid) in leads.items() if seeds[z]["type"]=="bedroom"]
    master=max(bedrooms,default=(0,-1,-1))[2]
    rooms=[]
    for rid,r in enumerate(rectangles):
        seed=seeds[r["zone"]];lead=leads[r["zone"]][1]==rid
        kind=("master" if r["zone"]==master else seed["type"]) if lead else ("balcony" if seed["type"]=="balcony" else "hall")
        rid_name="bath2" if lead and kind=="bathroom" and not any(x["id"]=="bath2" for x in rooms) else "kitchen" if lead and kind=="kitchen" else f"image-{rid}"
        if lead and kind=="bathroom" and rid_name!="bath2" and not any(x["id"]=="ensuite" for x in rooms):rid_name="ensuite";kind="ensuite"
        label={"living":"거실","kitchen":"주방·식당","master":"안방","bedroom":"침실","bathroom":"욕실","balcony":"발코니","entrance":"현관","dressroom":"드레스룸"}.get(seed["type"],"실내 공간")
        rooms.append({"id":rid_name,"type":kind,"label":label,"rect":[round(v,4) for v in r["rect"]],"zone":f"image-zone-{r['zone']}"})
    openings=[];seen=set();connections=set()
    boundaries={}
    # Emit one contiguous boundary run per pair of rectangles. Internal decomposition seams
    # become full-height openings; actual wall gaps become doors, not randomly placed doors.
    for c,rid in cell_room.items():
        for q in [(c[0]+1,c[1]),(c[0],c[1]+1)]:
            other=cell_room.get(q)
            if other is None or other==rid:
                continue
            vertical=c[0]!=q[0];axis="x" if vertical else "z";at=xs[q[0]] if vertical else ys[q[1]]
            lo,hi=(ys[c[1]],ys[c[1]+1]) if vertical else (xs[c[0]],xs[c[0]+1])
            za,zb=rectangles[rid]["zone"],rectangles[other]["zone"]
            boundaries.setdefault((min(za,zb),max(za,zb),axis,at),[]).append((lo,hi,rid,other))
    # Reconstruct complete physical interfaces BEFORE locating a door. A door can span
    # several decomposition rectangles; treating those slivers separately erased bathroom
    # leaves, shifted their centres and produced fake jambs inside open living areas.
    for (za,zb,axis,at),parts in boundaries.items():
        merged=[]
        for lo,hi,_,_ in sorted(parts):
            if merged and lo<=merged[-1][1]+.1:merged[-1][1]=max(hi,merged[-1][1])
            else:merged.append([lo,hi])
        vertical=axis=="x";measure=Z if vertical else X;p=round(at)
        for lo,hi in merged:
            l,h=round(lo),round(hi)
            sample=wall[l:h,max(0,p-3):p+4] if vertical else wall[max(0,p-3):p+4,l:h]
            if not sample.size:continue
            solid=sample.max(axis=1 if vertical else 0)>0;coverage=float(solid.mean())
            kinds={seeds[za]["type"],seeds[zb]["type"]};private=bool(kinds&{"bedroom","bathroom","entrance","dressroom"})
            if coverage<.13:
                # A private-room doorway remains a door even if an unrelated grid line
                # sliced precisely at its jamb. Demand supporting wall ink nearby.
                nearby=wall[max(0,l-60):min(H,h+60),max(0,p-3):p+4] if vertical else wall[max(0,p-3):p+4,max(0,l-60):min(W,h+60)]
                supported=nearby.size and float((nearby.max(axis=1 if vertical else 0)>0).mean())>.2
                kind="door" if za!=zb and private and .50<=measure(hi)-measure(lo)<=1.8 and supported else "open"
                intervals=[(lo,hi,kind)]
            else:
                intervals=[(l+a,l+b,"door" if za!=zb and private and measure(l+b)-measure(l+a)<=1.8 else "open") for a,b in _runs(~solid) if measure(l+b)-measure(l+a)>=.50]
                if "balcony" in kinds:
                    bold=thick[l:h,max(0,p-3):p+4] if vertical else thick[max(0,p-3):p+4,l:h]
                    glazing=[]
                    for a,b in _runs(bold.max(axis=1 if vertical else 0)==0):
                        if measure(l+b)-measure(l+a)>=.8:glazing.append((l+a,l+b,"window"))
                    intervals=[run for run in intervals if not any(min(run[1],w[1])-max(run[0],w[0])>.2*(run[1]-run[0]) for w in glazing)]+glazing
            for begin,end,kind in intervals:
                mid=(begin+end)/2
                _,_,ra,rb=min(parts,key=lambda part:max(part[0]-mid,0,mid-part[1]))
                if kind=="window" and seeds[rectangles[ra]["zone"]]["type"]=="balcony":ra,rb=rb,ra
                a,b=measure(begin),measure(end)
                hinge="start";swing=rooms[ra]["id"]
                if kind=="door":
                    depth=max(12,round((end-begin)*.8));scores=[]
                    for endpoint in [round(begin),round(end)]:
                        for direction in [-1,1]:
                            near,far=sorted((p+direction*7,p+direction*depth))
                            patch=neutral[max(0,endpoint-2):endpoint+3,max(0,near):far] if vertical else neutral[max(0,near):far,max(0,endpoint-2):endpoint+3]
                            scores.append(float((patch>0).mean()) if patch.size else 0)
                    best=int(np.argmax(scores));hinge="end" if best>=2 else "start"
                    direction=-1 if best%2==0 else 1
                    for candidate in [ra,rb]:
                        rect=rectangles[candidate]["grid"];centre=(xs[rect[0]]+xs[rect[2]])/2 if vertical else (ys[rect[1]]+ys[rect[3]])/2
                        if (centre-at)*direction>0:swing=rooms[candidate]["id"]
                    # Bold corridor walls can outscore the thin leaf's hinge hint. A
                    # private-room door opens into that room, preserving the hallway.
                    priority={"bathroom":0,"dressroom":1,"bedroom":2,"entrance":3}
                    inside=[candidate for candidate in [ra,rb] if seeds[rectangles[candidate]["zone"]]["type"] in priority]
                    if inside:swing=rooms[min(inside,key=lambda candidate:priority[seeds[rectangles[candidate]["zone"]]["type"]])]["id"]
                openings.append({"type":kind,"a":rooms[ra]["id"],"b":rooms[rb]["id"],"axis":axis,"at":round(X(at) if vertical else Z(at),4),"center":round((a+b)/2,4),"width":round(b-a,4),"height":2.7 if kind=="open" else 1.6 if kind=="window" else 2.1,"sill":.55 if kind=="window" else 0,"hinge":hinge,"swingInto":swing})
    # Recover an exterior entrance spanning several rectangles (the image's door leaf
    # is perpendicular to the wall, unlike a parallel window frame). No invented hole.
    for axis,at,lo,hi in [("z",ys[0],round(xs[0]),round(xs[-1])),("z",ys[-1],round(xs[0]),round(xs[-1])),("x",xs[0],round(ys[0]),round(ys[-1])),("x",xs[-1],round(ys[0]),round(ys[-1]))]:
        vertical=axis=="x";p=round(at);measure=Z if vertical else X
        bold=thick[lo:hi,max(0,p-4):p+5] if vertical else thick[max(0,p-4):p+5,lo:hi]
        frame=neutral[lo:hi,max(0,p-3):p+4] if vertical else neutral[max(0,p-3):p+4,lo:hi]
        if not bold.size:continue
        solid=bold.max(axis=1 if vertical else 0)>0;thin=frame.max(axis=1 if vertical else 0)>0
        for begin,end in _runs(~solid):
            a,b=measure(lo+begin),measure(lo+end)
            if not .55<=b-a<=1.3 or begin<5 or end>len(solid)-5:continue
            outward=-1 if at==(xs[0] if vertical else ys[0]) else 1;depth=max(15,round((end-begin)*.8))
            near,far=sorted((p+outward*7,p+outward*depth));leaf=[]
            for endpoint in [lo+begin,lo+end]:
                patch=neutral[max(0,round(endpoint)-9):round(endpoint)+10,max(0,near):far] if vertical else neutral[max(0,near):far,max(0,round(endpoint)-9):round(endpoint)+10]
                leaf.append(float((patch>0).mean(axis=1 if vertical else 0).max()) if patch.size else 0)
            if max(leaf)<.45 or not solid[max(0,begin-10):begin].any() or not solid[end:end+10].any():continue
            mid=lo+(begin+end)/2
            candidates=[]
            for rid,r in enumerate(rectangles):
                i,j,ri,bj=r["grid"];edges=(xs[i],xs[ri]) if vertical else (ys[j],ys[bj]);start,stop=(ys[j],ys[bj]) if vertical else (xs[i],xs[ri])
                if any(abs(edge-at)<1 for edge in edges) and start<=mid<=stop:candidates.append(rid)
            if not candidates:continue
            rid=candidates[0]
            openings.append({"type":"front_door","a":rooms[rid]["id"],"b":"out","axis":axis,"at":round(X(at) if vertical else Z(at),4),"center":round((a+b)/2,4),"width":round(b-a,4),"height":2.1,"sill":0,"hinge":"end" if leaf[1]>leaf[0] else "start","swingInto":rooms[rid]["id"]})
    # Windows are located on observed long, thin frame runs on the outside boundary.
    for rid,r in enumerate(rectangles):
        i,j,ri,bj=r["grid"]
        for axis,at,lo,hi,outside in [("x",xs[i],ys[j],ys[bj],i==0),("x",xs[ri],ys[j],ys[bj],ri==nx),("z",ys[j],xs[i],xs[ri],j==0),("z",ys[bj],xs[i],xs[ri],bj==ny)]:
            if not outside:continue
            # Solid bold exterior walls are preserved; only a run of thin source framing is glazing.
            p=round(at);a,b=round(lo)+4,round(hi)-4
            sample=thick[a:b,max(0,p-5):p+6] if axis=="x" else thick[max(0,p-5):p+6,a:b]
            if sample.size==0:continue
            thin=sample.max(axis=1 if axis=="x" else 0)==0
            for start,end in _runs(thin):
                scale=sy if axis=="x" else sx;offset=y0 if axis=="x" else x0
                if (end-start)*scale<.8:continue
                # A blank outline is not evidence of glazing. Require observed framing,
                # and never place a window over the entrance just recovered above.
                frame=neutral[a+start:a+end,max(0,p-3):p+4] if axis=="x" else neutral[max(0,p-3):p+4,a+start:a+end]
                if not frame.size or float((frame.max(axis=1 if axis=="x" else 0)>0).mean())<.35:continue
                measure=Z if axis=="x" else X;begin,finish=measure(a+start),measure(a+end)
                if any(o["type"]=="front_door" and o["axis"]==axis and abs(o["at"]-(X(at) if axis=="x" else Z(at)))<.01 and o["center"]+o["width"]/2>begin and o["center"]-o["width"]/2<finish for o in openings):continue
                openings.append({"type":"window","a":rooms[rid]["id"],"b":"out","axis":axis,"at":round(X(at) if axis=="x" else Z(at),4),"center":round((begin+finish)/2,4),"width":round(finish-begin,4),"height":1.6,"sill":.55})
    counted=sum((r["rect"][2]-r["rect"][0])*(r["rect"][3]-r["rect"][1]) for rid,r in enumerate(rooms) if seeds[rectangles[rid]["zone"]]["type"] not in ("balcony","utility"))
    error=counted/exclusive_area-1
    usable_beds=all(min(rooms[rid]["rect"][2]-rooms[rid]["rect"][0],rooms[rid]["rect"][3]-rooms[rid]["rect"][1])>=1.9 for _,rid,_ in bedrooms)
    living_id=next((r["id"] for r in rooms if r["type"]=="living"),None)
    zone_by_id={r["id"]:r["zone"] for r in rooms}
    reachable={zone_by_id[living_id]} if living_id else set()
    for _ in rooms:
        before=len(reachable)
        for opening in openings:
            # Walker's diameter is 0.48 m; reject passages below that plus a margin.
            if opening["b"]=="out" or opening["type"]=="window" or opening["width"]<.50:continue
            a,b=zone_by_id[opening["a"]],zone_by_id[opening["b"]]
            if a in reachable:reachable.add(b)
            if b in reachable:reachable.add(a)
        if len(reachable)==before:break
    connected=all(r["zone"] in reachable for r in rooms if r["type"] in ("living","kitchen","master","bedroom","bathroom","ensuite"))
    status="ready" if abs(error)<.18 and len(bedrooms)>=1 and usable_beds and connected else "needs_review"
    elapsed=round((time.perf_counter()-started)*1000)
    return {"status":status,"reason":None if status=="ready" else "area_or_room_consistency","version":VERSION,
            "imageSize":[W,H],"pixelBounds":[int(x0),int(y0),int(x1),int(y1)],"scale":{"xMetresPerPixel":sx,"zMetresPerPixel":sy,"basis":"dimension_chains" if chain_applied else "recognized_dimensions" if dimension_scale else "area_calibration"},
            "dimensionConstraints":x_constraints+z_constraints,"dimensionChainsApplied":chain_applied,
            "recognizedDimensions":[{k:d[k] for k in ("text","millimetres","x","y","rotation","confidence")} for d in numeric],
            "rooms":rooms,"openings":openings,"areaM2":round(counted,2),"areaError":round(error,4),"elapsedMs":elapsed,
            "note":"원본 이미지의 벽·방 위치를 인식한 모델입니다. 도면 치수 인식과 공간 구분에 오차가 있을 수 있으며 가구·마감은 연출입니다."}
