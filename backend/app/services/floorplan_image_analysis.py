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
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from app.services.floorplan_geometry import enclosed_floor, read_areas, fit_area_scale, source_match

cv2.setNumThreads(1)
from app.services.floorplan_analysis_runtime import VERSION

_ROOM_TERMS={
    # (with Tesseract's usual Hangul misreads of 주방/식당 on small two-line labels)
    "kitchen":("주방","식당","키친","다이닝","KITCHEN","DINING","추방","주빙","식딩","식탕"),
    "living":("거실","리빙룸","LIVING"),
    "bedroom":("침실","짐실","참실","안방","BEDROOM","MASTERBED"),
    "bathroom":("욕실","화장실","BATHROOM","BATH","TOILET","WC"),
    "balcony":("발코니","베란다","BALCONY","VERANDA"),
    "entrance":("현관","ENTRANCE","FOYER"),
    "dressroom":("드레스","DRESSING","WALKINCLOSET"),
    "utility":("다용도","세탁실","UTILITY","LAUNDRY"),
}


def _room_types(text: str) -> set[str]:
    text=re.sub(r"[\s·,/&+._-]", "", text).upper()
    return {kind for kind,terms in _ROOM_TERMS.items() if any(term in text for term in terms)}


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
        args=[command, "stdin", "stdout", "--tessdata-dir", str(model_dir), "-l", "kor" if mode=="text" else "eng" if rotation or mode=="digits" else "kor+eng", "--oem", "1", "--psm", "6" if mode in ("text", "area") else "11"]
        if rotation or mode=="digits":args.extend(["-c","tessedit_char_whitelist=0123456789"])
        # Select TSV through parameters: a custom model directory need not contain
        # the operating system's `configs/tsv` file.
        result = subprocess.run(args+["-c","tessedit_create_tsv=1","-c","tessedit_create_txt=0"],
                                input=encoded, capture_output=True, timeout=12, check=True,
                                env={**os.environ,"OMP_THREAD_LIMIT":"1"})
    except (subprocess.SubprocessError, OSError):
        return []
    out = []
    # TSV has no quoting: a recognised '"' otherwise opened a quoted field that swallowed
    # every following row (a whole plan's room labels read as one garbage word).
    for row in csv.DictReader(io.StringIO(result.stdout.decode("utf8", "replace")), delimiter="\t", quoting=csv.QUOTE_NONE):
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


def _room_ocr(mask: np.ndarray, bounds: tuple[int,int,int,int], locate: np.ndarray | None = None, mode: str = "text", multiline:bool=False) -> list[dict]:
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
        if mode=="area" or multiline:
            if not (12<=w<=150 and 7<=h<=76 and .3<w/h<11):continue
        elif not (12<=w<=130 and 7<=h<=28 and .65<w/h<11):continue
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
    for word in _ocr(sheet,mode=mode):
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
    lines=cv2.morphologyEx(lines,cv2.MORPH_OPEN,np.ones((1,max(40,round((frame_end-frame_start)*.2))),np.uint8))
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
    if len(constraints)<2:return linear,[]
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
    order={id(w):k for k,w in enumerate(words)}
    for group in groups:
        if len(group)<2:continue
        at={"x":float(np.mean([w["x"] for w in group])),"y":float(np.mean([w["y"] for w in group]))}
        # Syllable boxes mapped back from the patch sheet can be a few pixels out of
        # order (방 before 주); the engine's own reading order is joined as well.
        texts=dict.fromkeys("".join(w["text"] for w in sorted(group,key=key)) for key in (lambda w:w["x"],lambda w:order[id(w)]))
        result.extend({**group[0],"text":text,**at} for text in texts)
    return result


def _crossed(ink: np.ndarray, a: int, b: int, c: int, d: int) -> bool:
    # (a narrow strip along a wall or door leaf is mostly ink, not an empty crossed box)
    if c-a<20 or d-b<20 or ink[b+5:d-5,a+5:c-5].mean()>.4:return False
    t=np.linspace(.08,.92,40);ys=(b+(d-b-1)*t).astype(int)
    return bool(ink[ys,(a+(c-a-1)*t).astype(int)].mean()>=.6 and ink[ys,(c-1-(c-a-1)*t).astype(int)].mean()>=.6)


def _tile_alternation(value: np.ndarray) -> float:
    """Grey/white changes per 100 px along rows (median): tile joints repeat, a door arc does not."""
    if value.shape[0]<3 or value.shape[1]<8:return 0.
    tiles=(value<246).astype(np.int8)
    return float(np.median(np.abs(np.diff(tiles,axis=1)).sum(1)/tiles.shape[1]*100))


KITCHEN_SPREAD=1.0
OPEN_KITCHEN_SHARE=.40
REFINE_CELL_METRES=1.2
KITCHEN_MIN_M2=6.
KITCHEN_MIN_SIDE=1.8


def _limit_open_kitchen(assigned,distances,seeds,cells,neighbours,barrier,xs,ys,scale=(1.,1.)) -> None:
    """Return the kitchen's surplus open floor to the living room it opens onto.

    The kitchen keeps its seed and the floor nearest it; cells farthest from the kitchen
    seed that border living floor without a wall move first, so both stay contiguous."""
    area=lambda c:(xs[c[0]+1]-xs[c[0]])*(ys[c[1]+1]-ys[c[1]])
    seed_cells={s["cell"] for s in seeds}
    for k,kitchen in enumerate(seeds):
        if kitchen["type"]!="kitchen":continue
        # (in a flat with a separate studio, the studio's kitchenette beside its combined
        # living/bedroom stays whole; a single kitchen is always held to the share)
        several=sum(s["type"]=="kitchen" for s in seeds)>1
        living=[i for i,s in enumerate(seeds) if s["type"]=="living" and not (several and s.get("combinedUses"))]
        if not living:return
        while True:
            own=[c for c,z in assigned.items() if z==k]
            open_living={}
            for c in own:
                for q,_ in neighbours[c]:
                    if assigned.get(q) in living and barrier(c,q)[0]<.13:open_living[c]=assigned[q]
            if not open_living:break
            shared=sum(area(c) for c,z in assigned.items() if z==k or (z in living and z in open_living.values()))
            if sum(area(c) for c in own)<=shared*OPEN_KITCHEN_SHARE:break
            # It stays a workable kitchen: room for the refrigerator, the counter run
            # and standing space in front of them.
            def workable(rest):
                if sum(area(c) for c in rest)*scale[0]*scale[1]<KITCHEN_MIN_M2:return False
                w=(xs[max(c[0] for c in rest)+1]-xs[min(c[0] for c in rest)])*scale[0];h=(ys[max(c[1] for c in rest)+1]-ys[min(c[1] for c in rest)])*scale[1]
                return min(w,h)>=KITCHEN_MIN_SIDE
            # (never at the price of a kitchen larger than the living room)
            living_area=sum(area(c) for c,z in assigned.items() if z in living)
            larger=sum(area(c) for c in own)>living_area
            movable=[c for c in open_living if c not in seed_cells and (larger or workable([q for q in own if q!=c]))]
            if not movable:break
            c=max(movable,key=lambda c:distances.get(c,0))
            assigned[c]=open_living[c]


def _rebalance_by_area(evidence,cells,assigned,seeds,neighbours,barrier,xs,ys,exclusive_area) -> int:
    """Room areas printed on the drawing are its own measurements: the floor the zones
    split between them follows them where the geodesic split and the open-kitchen share
    did not (kitchens came out at 40-65 % of their printed area, the living rooms they
    open onto 20-60 % over theirs).

    One isotropic scale from all printed rooms (as fit_area_scale), then each room short
    of its print by more than 8 % takes adjacent cells across open edges (no wall) from
    a room over its print, or from unprinted shared floor (living, hall, the entrance's
    untiled part) — nearest its own label first, never a labelled seed, never splitting
    the room it takes from, never bath tile for a dry room. Returns cells moved."""
    area=lambda c:(xs[c[0]+1]-xs[c[0]])*(ys[c[1]+1]-ys[c[1]])
    # (a 주방 및 식당 split for furnishing into kitchen and living keeps one print for both)
    group={z:s.get("areaGroup",z) for z,s in enumerate(seeds)}
    pixels={}
    for c,z in assigned.items():pixels[group[z]]=pixels.get(group[z],0)+area(c)
    printed={}
    for item in evidence:
        if item.get("scope")!="room":continue
        c=next((c for c in cells if xs[c[0]]<=item["x"]<=xs[c[0]+1] and ys[c[1]]<=item["y"]<=ys[c[1]+1]),None)
        z=assigned.get(c) if c is not None else None
        if z is None or item["areaM2"]>=exclusive_area*.9 or seeds[z]["type"] in ("balcony","utility"):continue
        z=group[z]
        if z not in printed or item.get("confidence",0)>printed[z][1]:printed[z]=(item["areaM2"],item.get("confidence",0))
    if len(printed)<2:return 0
    k2=math.exp(sum(math.log(a/pixels[z]) for z,(a,_) in printed.items())/len(printed))   # m2 per pixel2
    target={z:a/k2 for z,(a,_) in printed.items()}
    seed_cells={s["cell"] for s in seeds}
    shared_kinds=("living","hall","kitchen","entrance")
    def connected_without(z,q):
        own=[c for c,v in assigned.items() if v==z and c!=q]
        if not own:return False
        seen={own[0]};stack=[own[0]]
        while stack:
            p=stack.pop()
            for n,_ in neighbours[p]:
                if n!=q and n not in seen and assigned.get(n)==z:seen.add(n);stack.append(n)
        return len(seen)==len(own)
    moved=0
    for _ in range(400):
        short=[(1-pixels[z]/t,z) for z,t in target.items() if pixels.get(z,0)<t*.92]
        if not short:break
        short.sort(reverse=True);progress=False
        for _,z in short:
            kind=seeds[z]["type"];home=cells[seeds[z]["cell"]]["center"]
            candidates=[]
            for c,v in list(assigned.items()):
                if group[v]!=z:continue
                for q,_ in neighbours[c]:
                    d=assigned.get(q)
                    if d is None or group[d]==z or q in seed_cells or barrier(c,q)[0]>=.13:continue
                    f=cells[q]
                    if kind not in ("bathroom",) and f.get("blue",0)>.25:continue
                    if f.get("checker") and kind!="entrance":continue
                    g=group[d]
                    surplus=g in target and pixels[g]-area(q)>=target[g]*.96
                    free=g not in target and seeds[d]["type"] in shared_kinds and not (seeds[d]["type"]=="entrance" and f.get("checker"))
                    if not (surplus or free):continue
                    candidates.append((math.dist(f["center"],home),q,d,v))
            for _,q,d,v in sorted(candidates):
                if not connected_without(d,q):continue
                assigned[q]=v;pixels[z]+=area(q);pixels[group[d]]-=area(q);moved+=1;progress=True;break
            if progress:break
        if not progress:break
    return moved


def _analyze_image(data: bytes, exclusive_area: float, *, words: list[dict] | None = None, expanded:bool=False,supply_area:float|None=None, _axis_recovery:bool=False) -> dict:
    started = time.perf_counter()
    if not isinstance(exclusive_area, (int, float)) or not math.isfinite(exclusive_area) or not 5 <= exclusive_area <= 1000:
        return {"status":"needs_review", "reason":"exclusive_area", "version":VERSION}
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
        # Faded scans and monochrome line plans have no black, bold wall fill.
        neutral_ink=((gray<185)&(im.max(2)-im.min(2)<45)).astype(np.uint8)*255
        span=max(20,round(min(H,W)*.065))
        thin_h=cv2.morphologyEx(neutral_ink,cv2.MORPH_OPEN,np.ones((1,span),np.uint8))
        thin_v=cv2.morphologyEx(neutral_ink,cv2.MORPH_OPEN,np.ones((span,1),np.uint8))
        thick=thin_h|thin_v
        n,labels,stats,_=cv2.connectedComponentsWithStats(thick)
        ids=[i for i in range(1,n) if stats[i,4]>100 and max(stats[i,2:4])>min(H,W)*.08]
        points=np.argwhere(np.isin(labels,ids))
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
    strong_h,strong_v=horizontal.copy(),vertical.copy()
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
        room_number_mask=number_mask.copy()
        number_mask[max(0,y0-3):y1+4,max(0,x0-3):x1+4]=0
        words = room_words + _ocr(255-number_mask,mode="digits") + _ocr(255-number_mask,90,mode="digits")
        # Preserve decimal points and square-metre units inside rooms. The perimeter
        # digit-only pass intentionally cannot supply this evidence.
        area_words=_room_ocr(ocr_mask, (x0,y0,x1,y1), mode="area")
        known_texts=[w["text"] for w in _phrases(room_words)]
        groups=[("거실",),("주방","식당"),("침실","짐실","안방"),("욕실","화장실"),("현관",),("발코니","베란다")]
        missing=[g for g in groups if not any(any(term in t for term in g) for t in known_texts)]
        known_kinds=set().union(*(_room_types(t) for t in known_texts))
        # The multiline pass supplies missing labels and areas; its lower-quality
        # alternative spellings cannot displace already observed room anchors.
        words += [w for w in area_words if any(c.isdigit() for c in w["text"]) or _room_types(w['text'])-known_kinds or any(any(term in w["text"] for term in g) for g in missing)]
        if any(g in missing for g in groups[:3]):
            words += [w for w in _room_ocr(room_number_mask,(x0,y0,x1,y1),multiline=True) if any(any(term in w["text"] for term in g) for g in missing)]
        observed=set().union(*(_room_types(w['text']) for w in _phrases(words)))
        if not {'living','kitchen','bedroom'}.issubset(observed):
            # Korean-only OCR can lose English labels or spaced room names.
            # Retry the same source patches with the bilingual model; geometry
            # still comes from the unmodified source pixels.
            mixed=ocr_mask.copy();mixed[cv2.dilate(strong_h|strong_v,np.ones((3,3),np.uint8))>0]=0
            words += [w for w in _room_ocr(mixed,(x0,y0,x1,y1),mode='mixed') if _room_types(w['text'])-observed]
    area_evidence = read_areas(words, (x0,y0,x1,y1))
    recognized_words=words
    words = _phrases(words)
    # Thin counter/appliance outlines near the upper edge are not glazing. Keep
    # weak frames at the perimeter or alongside an observed balcony, while bold
    # structural strokes always retain their source positions.
    balcony_words=[w for w in words if any(t in w["text"] for t in ("발코니","베란다"))]
    for axis,weak in [("x",weak_v),("z",weak_h)]:
        contours,_=cv2.findContours(weak,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            x,y,w,h=cv2.boundingRect(contour)
            perimeter=min(abs(x-x0),abs(x+w-x1))<10 if axis=="x" else min(abs(y-y0),abs(y+h-y1))<10
            beside=any((y-5<=b["y"]<=y+h+5 and abs(b["x"]-(x+w/2))<(x1-x0)*.25) if axis=="x" else (x-5<=b["x"]<=x+w+5 and abs(b["y"]-(y+h/2))<(y1-y0)*.45) for b in balcony_words)
            if not perimeter and not beside:weak[y:y+h,x:x+w]=0
    horizontal=strong_h|weak_h;vertical=strong_v|weak_v;wall=horizontal|vertical
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
    single_axis=False
    has_dimension_axis=False
    if chain_applied:
        sx,sy=(X(x1)-X(x0))/(x1-x0),(Z(y1)-Z(y0))/(y1-y0)
        dimension_scale=True
    else:
        sx = (_dimension_scale(dx,gray,"x",(x0,y0,x1,y1)) or dx["millimetres"]/1000/(x1-x0)) if dx else None
        sy = (_dimension_scale(dy,gray,"z",(x0,y0,x1,y1)) or dy["millimetres"]/1000/(y1-y0)) if dy else None
        if x_constraints:sx=(X(x1)-X(x0))/(x1-x0)
        if z_constraints:sy=(Z(y1)-Z(y0))/(y1-y0)
        has_dimension_axis=bool(sx or sy)
        single_axis=bool(sx) != bool(sy)
        dimension_scale=sx is not None and sy is not None
        if sx and sy and not .65<sx/sy<1.55:
            # OCR engines can omit one chain's ticks or join adjacent digits. With
            # several real dimension observations, retain the plausible measured
            # axis and the original image aspect ratio instead of stretching to the
            # conflicting value. Geometry/area/walking validation still applies.
            if len(xdim)+len(ydim)>=4:
                candidates=[value for value,observations in [(sx,xdim),(sy,ydim)] if len(observations)>=2 and .7*default_scale<value<1.4*default_scale]
                if candidates:
                    sx=sy=min(candidates,key=lambda value:abs(math.log(value/default_scale)));single_axis=True
                else:
                    sx=sy=default_scale;dimension_scale=False;has_dimension_axis=False
            else:
                return {"status":"needs_review","reason":"dimension_conflict","version":VERSION,"recognizedDimensions":numeric}
        sx,sy=sx or sy or default_scale,sy or sx or default_scale
        X=lambda v:float((v-x0)*sx)
        Z=lambda v:float((v-y0)*sy)
    xs: list[float] = [float(x0), float(x1)]
    ys: list[float] = [float(y0), float(y1)]
    # Surface bounds guide room decomposition without inventing structural walls.
    surface_hsv=cv2.cvtColor(im,cv2.COLOR_BGR2HSV)
    for word in words:
        if not any(t in word["text"] for t in ("현관","다용도")) or not (x0<word["x"]<x1 and y0<word["y"]<y1):continue
        cx,cy=round(word["x"]),round(word["y"])
        for axis,values,origin,limit in [(0,xs,cx,W),(1,ys,cy,H)]:
            for direction in [-1,1]:
                consecutive=0
                for step in range(5,round(min(x1-x0,y1-y0)*.3)):
                    at=origin+direction*step
                    if not 2<=at<limit-2:break
                    patch=surface_hsv[max(0,cy-3):cy+4,at] if axis==0 else surface_hsv[at,max(0,cx-3):cx+4]
                    boundary=bool(((patch[:,1]>45)|(patch[:,2]<100)).mean()>.6)
                    consecutive=consecutive+1 if boundary else 0
                    if consecutive>=3:
                        coordinate=float(at-direction*2)
                        if all(abs(v-coordinate)>7 for v in values):values.append(coordinate)
                        break
    for axis, mask in [("x", vertical), ("y", horizontal)]:
        contours, _ = cv2.findContours(mask[y0:y1+1, x0:x1+1], cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            if axis == "x" and h > minimum * 1.5 and w < 15:
                xs.append(x0 + x + (w - 1) / 2)
            if axis == "y" and w > minimum * 1.5 and h < 15:
                ys.append(y0 + y + (h - 1) / 2)
        # Connected lintels can join parallel strokes into a wide contour. Recover
        # their individual axes from sustained line support, retaining both walls.
        crop=mask[y0:y1+1,x0:x1+1]>0
        support=crop.sum(axis=0 if axis=="x" else 1)
        values=xs if axis=="x" else ys;origin=x0 if axis=="x" else y0
        for lo,hi in _runs(support>minimum*1.5) if _axis_recovery else []:
            if hi-lo>max(15,minimum):continue
            center=origin+float(np.average(np.arange(lo,hi),weights=support[lo:hi]))
            if all(abs(v-center)>7 for v in values):values.append(center)
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
    enclosed = enclosed_floor(wall, (x0,y0,x1,y1))
    monochrome=float((hsv[y0:y1,x0:x1,1]>35).mean())<.03
    white_regions=((hsv[:,:,1]<15)&(hsv[:,:,2]>160)).astype(np.uint8)*255
    white_regions=cv2.morphologyEx(white_regions,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
    white_regions[cv2.dilate(wall,np.ones((3,3),np.uint8))>0]=0
    _,white_ids,white_stats,_=cv2.connectedComponentsWithStats(white_regions)
    diagonal_ink=cv2.dilate((gray<120).astype(np.uint8),np.ones((3,3),np.uint8))
    edge_strength=np.hypot(cv2.Sobel(gray,cv2.CV_32F,1,0),cv2.Sobel(gray,cv2.CV_32F,0,1))
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
            inside = float((enclosed[b:d,a:c] > 0).mean())
            labelled=any(xs[i]<w["x"]<xs[i+1] and ys[j]<w["y"]<ys[j+1] and _room_types(w['text']) for w in words)
            # A pale grey checkered entrance tile reads as near-white paper. Its dense
            # tile joints tell it apart from a blank recess; dropping it left dead floor.
            light=float(((patch[:,:,2]>200)&(patch[:,:,2]<248)&(patch[:,:,1]<20)).mean())
            # (alternating with white tiles: a solid grey service floor is not a checker)
            checker=bool(.15<light<.8 and float((patch[:,:,2]>=248).mean())>.15 and float((edge_strength[b:d,a:c]>40).mean())>.18 and float(patch[:,:,1].mean())<6
                         and min(_tile_alternation(patch[:,:,2]),_tile_alternation(patch[:,:,2].T))>=7)
            # A box crossed corner to corner is a shaft or duct, never floor; kept, it hung
            # walkable side pockets off bathrooms.
            if _crossed(diagonal_ink,round(xs[i]),round(ys[j]),round(xs[i+1]),round(ys[j+1])):continue
            # (an entrance's tiles stay floor even where its front door leaves the outline open)
            if occupied < .12 and not checker and not (inside>=.65 and (monochrome or labelled)):
                continue
            floor_fill=float(((patch[:,:,1]>15)|((patch[:,:,2]>110)&(patch[:,:,2]<232))).mean())
            if not monochrome and not dimension_scale and not has_dimension_axis and floor_fill<.12 and not labelled and not checker:
                ids,counts=np.unique(white_ids[b:d,a:c],return_counts=True)
                parts=[(int(count),int(k)) for k,count in zip(ids,counts) if k]
                region=max(parts,default=(0,0))[1]
                # Preserve small white fixture footprints within rooms; a large
                # unlabelled white stairwell outside the flat is not usable floor.
                if not region or white_stats[region,4]>(x1-x0)*(y1-y0)*.12:continue
            cells[i, j] = {"center": ((xs[i]+xs[i+1])/2, (ys[j]+ys[j+1])/2),
                           "blue":float(((patch[:,:,0]>75)&(patch[:,:,0]<115)&(patch[:,:,1]>15)).mean()),
                           "wood":float(((patch[:,:,0]>8)&(patch[:,:,0]<40)&(patch[:,:,1]>85)).mean()),
                           "pale":float(((patch[:,:,0]>10)&(patch[:,:,0]<40)&(patch[:,:,1]>15)&(patch[:,:,1]<100)&(patch[:,:,2]>190)).mean()),
                           "checker":checker,
                           # tile joints: a balcony's or a bathroom's tiled floor has them, a room's plain floor not
                           "joints":float((edge_strength[b:d,a:c]>40).mean())}
    # A crossed shaft box split by grid lines: test the X over blocks of up to 3x3 cells.
    for (i,j) in sorted(cells):
        for w,h in [(2,1),(1,2),(2,2),(3,1),(1,3),(3,2),(2,3),(3,3)]:
            block=[(i+u,j+v) for u in range(w) for v in range(h)]
            if all(c in cells for c in block) and _crossed(diagonal_ink,round(xs[i]),round(ys[j]),round(xs[i+w]),round(ys[j+h])):
                for c in block:cells.pop(c,None)
                break
    # Wall-free subdivision of wide floor cells. A large open living/kitchen area is
    # otherwise one or two grid cells, and the kitchen could only take all of it or
    # none. Each piece keeps its parent's floor decision; the lines carry no wall.
    def refined(axis:list[float],scale:float)->list[float]:
        out=[axis[0]]
        for v in axis[1:]:
            pieces=max(1,math.ceil((v-out[-1])*scale/REFINE_CELL_METRES)) if (v-out[-1])*scale>REFINE_CELL_METRES*1.25 else 1
            out.extend(out[-1]+(v-out[-1])*k/pieces for k in range(1,pieces));out.append(v)
        return out
    fine_xs,fine_ys=refined(xs,sx),refined(ys,sy)
    if len(fine_xs)>len(xs) or len(fine_ys)>len(ys):
        parent=lambda values,fine,k:next(i for i in range(len(values)-1) if values[i]-1e-6<=fine[k] and fine[k+1]<=values[i+1]+1e-6)
        fine_cells={}
        for j in range(len(fine_ys)-1):
            for i in range(len(fine_xs)-1):
                source=cells.get((parent(xs,fine_xs,i),parent(ys,fine_ys,j)))
                if source is None:continue
                a,b,c,d=round(fine_xs[i])+1,round(fine_ys[j])+1,round(fine_xs[i+1])-1,round(fine_ys[j+1])-1
                patch=hsv[b:max(b+1,d),a:max(a+1,c)]
                fine_cells[i,j]={**source,"center":((fine_xs[i]+fine_xs[i+1])/2,(fine_ys[j]+fine_ys[j+1])/2),
                                 "blue":float(((patch[:,:,0]>75)&(patch[:,:,0]<115)&(patch[:,:,1]>15)).mean()),
                                 "wood":float(((patch[:,:,0]>8)&(patch[:,:,0]<40)&(patch[:,:,1]>85)).mean()),
                                 "pale":float(((patch[:,:,0]>10)&(patch[:,:,0]<40)&(patch[:,:,1]>15)&(patch[:,:,1]<100)&(patch[:,:,2]>190)).mean())}
        xs,ys,cells=fine_xs,fine_ys,fine_cells;nx,ny=len(xs)-1,len(ys)-1
    if not cells:
        return {"status": "needs_review", "reason": "floor_detection", "version": VERSION}

    barrier_memo: dict = {}
    def barrier(a: tuple[int, int], b: tuple[int, int]) -> tuple[float, list[tuple[float, float]]]:
        if (a,b) not in barrier_memo:barrier_memo[a,b]=_barrier(a,b)
        return barrier_memo[a,b]

    def _barrier(a: tuple[int, int], b: tuple[int, int]) -> tuple[float, list[tuple[float, float]]]:
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
    # Containment beats the nearest centre in a narrow strip next to a large room.
    def locate(point):
        containing=next((c for c in cells if xs[c[0]]<=point[0]<=xs[c[0]+1] and ys[c[1]]<=point[1]<=ys[c[1]+1]),None)
        return containing if containing is not None else min(cells,key=lambda c:math.dist(cells[c]["center"],point))
    room_patterns=list(_ROOM_TERMS)
    for word in words:
        if word.get("rotation",0) != 0 or not (x0 < word["x"] < x1 and y0 < word["y"] < y1):
            continue
        observed_types=_room_types(word['text'])
        kind = next((kind for kind in room_patterns if kind in observed_types), None)
        if not kind:
            continue
        seed_cell = locate((word["x"],word["y"])) if monochrome or kind in ("entrance","utility") else min(cells,key=lambda c:math.dist(cells[c]["center"],(word["x"],word["y"])))
        prior=next((s for s in seeds if s["cell"]==seed_cell),None)
        if prior and {prior["type"],kind}=={"living","bedroom"}:
            prior.update(type="living",label="거실·침실 겸용",combinedUses=["living","bedroom"])
            continue
        if prior and prior["type"]==kind:
            continue
        combined={'living','bedroom'}.issubset(observed_types)
        seeds.append({"cell": seed_cell, "type": "living" if combined else kind, "label": word["text"], "observed": True,**({"combinedUses":["living","bedroom"]} if combined else {})})
    kinds = {s["type"] for s in seeds}
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
    # An unlabelled checkered tile floor is the entrance, an explicit visual inference.
    if not any(s["type"]=="entrance" for s in seeds):
        tiles=[c for c in cells if cells[c]["checker"] and cells[c]["blue"]<.05 and not any(s["cell"]==c for s in seeds)]
        # The connected tiled floor a person stands on, not a small crossed shaft box.
        groups=[];pending=set(tiles)
        while pending:
            group={pending.pop()};queue=list(group)
            while queue:
                c=queue.pop()
                for q in [(c[0]+1,c[1]),(c[0]-1,c[1]),(c[0],c[1]+1),(c[0],c[1]-1)]:
                    if q in pending:pending.discard(q);group.add(q);queue.append(q)
            groups.append(group)
        def footprint(group):
            w=(xs[max(c[0] for c in group)+1]-xs[min(c[0] for c in group)])*sx;h=(ys[max(c[1] for c in group)+1]-ys[min(c[1] for c in group)])*sy
            return sum((xs[c[0]+1]-xs[c[0]])*(ys[c[1]+1]-ys[c[1]]) for c in group)*sx*sy,min(w,h)
        groups=[g for g in groups if footprint(g)[0]>=.6 and footprint(g)[1]>=.55]
        if groups:
            group=max(groups,key=lambda g:footprint(g)[0])
            seed_cell=max(group,key=lambda c:(xs[c[0]+1]-xs[c[0]])*(ys[c[1]+1]-ys[c[1]]))
            seeds.append({"cell":seed_cell,"type":"entrance","label":"현관 (타일 무늬 인식)","observed":False})
    # A colour-inferred bedroom (its label hidden) inside a room that already has a seed is
    # that room, not a second one: two seeds split one bedroom into two half rooms with a
    # wall between them that the drawing does not have (a printed 7.17 m2 bedroom became
    # 4.0 + 4.2). Kept only where its wall-enclosed floor holds no other seed.
    def open_region(start):
        region={start};pending=[start]
        while pending:
            p=pending.pop()
            for q,_ in neighbours[p]:
                if q not in region and barrier(p,q)[0]<.13 and cells[q]["blue"]<.05:
                    region.add(q);pending.append(q)
        return region
    # The OCR passes (orientations, modes) read one label more than once, a little apart and
    # sometimes garbled ('침실' and '짐침실실' 6 cm lower): a seed of a type already seeded in
    # the same wall-enclosed floor is that room again — kept, it halved the room.
    kept=[]
    for seed in seeds:
        region=None
        if not seed["observed"] and seed["type"]=="bedroom":
            region=open_region(seed["cell"])
            if any(o["cell"] in region for o in seeds if o is not seed and (o["observed"] or o in kept)):continue
        # (near: a doorway is an open edge too, so the open floor alone would join two rooms;
        # a label read twice lands within a line or two of itself)
        here=cells[seed["cell"]]["center"]
        near=[o for o in kept if o["type"]==seed["type"] and seed["type"]!="kitchen" and math.dist(cells[o["cell"]]["center"],here)<120]
        if near:
            region=region or open_region(seed["cell"])
            if any(o["cell"] in region for o in near):continue
        kept.append(seed)
    seeds=kept
    # '주방' and '식당' can be two OCR anchors in the same open room. Give that
    # physical space one kitchen identity; duplicate IDs misrouted shared walls.
    unique=[]
    for seed in seeds:
        duplicate=False
        if seed["type"]=="kitchen":
            reachable_cells={seed["cell"]};pending=[seed["cell"]]
            while pending:
                p=pending.pop()
                for q,_ in neighbours[p]:
                    if q not in reachable_cells and barrier(p,q)[0]<.13 and cells[q]["blue"]<.05 and cells[q]["pale"]<.5:
                        reachable_cells.add(q);pending.append(q)
            duplicate=any(s["type"]=="kitchen" and s["cell"] in reachable_cells for s in unique)
        if not duplicate:unique.append(seed)
    seeds=unique
    kinds={s["type"] for s in seeds}
    if "living" not in kinds and {"kitchen","bedroom"}.issubset(kinds):
        # Small older flats often label the entire common room '주방 및 식당'.
        # Split furnishing uses only within that observed open wood-floor region;
        # no wall is added and its printed area remains one shared constraint.
        kitchen_index=next(i for i,s in enumerate(seeds) if s["type"]=="kitchen")
        kitchen=seeds[kitchen_index];region={kitchen["cell"]};pending=[kitchen["cell"]]
        while pending:
            p=pending.pop()
            for q,_ in neighbours[p]:
                if q not in region and barrier(p,q)[0]<.13 and cells[q]["blue"]<.05 and cells[q]["pale"]<.5:
                    region.add(q);pending.append(q)
        candidates=[c for c in region if cells[c]["wood"]>.25 and not any(s["cell"]==c for s in seeds)]
        if candidates:
            origin=cells[kitchen["cell"]]["center"]
            candidate=max(candidates,key=lambda c:math.dist(cells[c]["center"],origin)*math.sqrt((xs[c[0]+1]-xs[c[0]])*(ys[c[1]+1]-ys[c[1]])))
            if math.dist(cells[candidate]["center"],origin)*min(sx,sy)>.8:
                kitchen["areaGroup"]=kitchen_index
                seeds.append({"cell":candidate,"type":"living","label":"주방·식당 공용 생활 공간 (용도 추정)","observed":False,"areaGroup":kitchen_index})
    kinds={s["type"] for s in seeds}
    combined_sleep=any('bedroom' in s.get('combinedUses',[]) for s in seeds)
    if not {"living", "kitchen"}.issubset(kinds) or not ('bedroom' in kinds or combined_sleep):
        return {"status":"needs_review","reason":"room_labels","version":VERSION,"recognizedDimensions":numeric,"recognizedRoomTypes":sorted(kinds),"recognizedAreas":area_evidence,"elapsedMs":round((time.perf_counter()-started)*1000)}
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
            # White bathtubs/sanitary surfaces belong to the wet room too. A
            # blanket penalty for every non-blue cell assigned their strips to a
            # neighbouring balcony/bedroom and invented full-width bathroom doors.
            mismatch=500 if kind=="bathroom" and feature["blue"]<.05 and (feature["wood"]>.25 or feature["pale"]>.5) else 200 if kind=="balcony" and feature["wood"]>.4 else 150 if kind in ("living","kitchen") and feature["pale"]>.5 else 150 if kind=="bedroom" and (feature["wood"]>.45 or feature["blue"]>.25) else 0
            # A wet room is enclosed: across a wall or door it never takes untiled floor
            # (an unlabelled entrance strip became a shower room).
            if kind in ("bathroom","utility") and feature["blue"]<.05 and cost>=100:mismatch+=400
            # The entrance is its tile floor; it does not take the hall beyond it — labelled or
            # not, the wood-floored hall past its step belongs to the living/kitchen side (a
            # labelled 현관 took the dining half of a 주방 및 식당 and shrank the kitchen to 40 %).
            if kind=="entrance" and not feature.get("checker") and (not seeds[index]["observed"] or feature["wood"]>.25):mismatch+=300
            # A private room ends at its walls: across a wall or its door it does not take the
            # wood-floored corridor or dining floor outside (a bedroom grew a strip out of its door
            # and the shared floor it took left the kitchen and the hall short).
            if kind in ("bedroom","dressroom") and cost>=100 and feature["wood"]>.25 and feature["pale"]<.5:mismatch+=400
            # A tiled balcony (its floor's joints) ends at its window: a window frame inside the
            # plan is no barrier, and the balcony took the bedroom's plain floor behind it — a strip
            # of the bedroom left balcony, with no way into it.
            if kind=="balcony" and cells[seeds[index]["cell"]].get("joints",0)>=.2 and feature.get("joints",1)<.06:mismatch+=300
            # Korean flats open the kitchen onto the living room, which is kept wide. The
            # kitchen spreads at a higher cost, so the shared floor, dining area and the
            # corridor belong to the living room rather than the kitchen.
            nd=distance+cost*(KITCHEN_SPREAD if kind=="kitchen" else 1)+mismatch
            if nd<distances.get(q,float("inf")):
                distances[q]=nd;assigned[q]=index;heapq.heappush(queue,(nd,index,q))
    _limit_open_kitchen(assigned,distances,seeds,cells,neighbours,barrier,xs,ys,(sx,sy))
    rebalanced=_rebalance_by_area(area_evidence,cells,assigned,seeds,neighbours,barrier,xs,ys,exclusive_area)
    area_constraints=[]
    area_scale_applied=False
    area_annotation_conflict=False
    if not dimension_scale and not has_dimension_axis:
        # Calibrate the actual occupied room union, excluding labelled balconies.
        # Both axes share one scalar so source width/height ratios are preserved.
        scale,area_constraints,conflict=fit_area_scale(area_evidence,cells,assigned,seeds,xs,ys,exclusive_area)
        if conflict:
            # An annotation mismatch does not invalidate the observed structure.
            # Keep every source pixel coordinate and calibrate the occupied floor
            # union to the selected original's exclusive area, without stretching
            # individual rooms or substituting a template.
            counted_pixels=sum((xs[i+1]-xs[i])*(ys[j+1]-ys[j]) for (i,j),z in assigned.items() if seeds[z]["type"] not in ("balcony","utility"))
            scale=math.sqrt(exclusive_area/max(1,counted_pixels))
            area_annotation_conflict=True
            for item in area_constraints:item['relativeResidual']=round(abs(item['pixelArea']*scale*scale-item['areaM2'])/item['areaM2'],4)
        sx=sy=scale;X=lambda v:float((v-x0)*sx);Z=lambda v:float((v-y0)*sy)
        area_scale_applied=bool(area_constraints) and not area_annotation_conflict
    # Merge adjacent cells only across a wall-free edge and within one observed room zone.
    consumed=set();rectangles=[];cell_room={};_zone_barrier=barrier
    def grow(i,j,index):
        """The largest wall-free rectangle of one zone with its top-left cell at (i,j)."""
        # Inside a bathroom or kitchen, lines are its bath, shower and counter outlines:
        # one room. Splitting there left a 1.2 m strip with no room for the counter.
        barrier=(lambda a,b:(0.,[])) if seeds[index]["type"] in ("bathroom","utility","kitchen") else _zone_barrier
        limit=i+1
        while (limit,j) in cells and (limit,j) not in consumed and assigned.get((limit,j))==index and barrier((limit-1,j),(limit,j))[0]<.10:
            limit+=1
        best=(-1.,i+1,j+1)
        for right_candidate in range(i+1,limit+1):
            bottom_candidate=j+1
            while bottom_candidate<ny and all((k,bottom_candidate) in cells and (k,bottom_candidate) not in consumed and assigned.get((k,bottom_candidate))==index and barrier((k,bottom_candidate-1),(k,bottom_candidate))[0]<.10 and (k==i or barrier((k-1,bottom_candidate),(k,bottom_candidate))[0]<.10) for k in range(i,right_candidate)):
                bottom_candidate+=1
            candidate_area=(xs[right_candidate]-xs[i])*(ys[bottom_candidate]-ys[j])
            if candidate_area>best[0]:best=(candidate_area,right_candidate,bottom_candidate)
        return best
    # Take each zone's largest rectangle first, not the first one met in scan order:
    # an L-shaped living room otherwise led with a narrow strip and furnished that.
    while True:
        best=None
        for c in assigned:
            if c in consumed or c not in cells:continue
            candidate=grow(c[0],c[1],assigned[c])
            # A kitchen leads with a piece deep enough for its counter and standing room.
            if seeds[assigned[c]]["type"]=="kitchen" and min((xs[candidate[1]]-xs[c[0]])*sx,(ys[candidate[2]]-ys[c[1]])*sy)<KITCHEN_MIN_SIDE:
                candidate=(candidate[0]*.3,candidate[1],candidate[2])
            if best is None or candidate[0]>best[0][0]:best=(candidate,c)
        if best is None:break
        (_,right,bottom),(i,j)=best;index=assigned[i,j]
        rid=len(rectangles)
        for yy in range(j,bottom):
            for xx in range(i,right):
                consumed.add((xx,yy));cell_room[xx,yy]=rid
        rectangles.append({"zone":index,"grid":[i,j,right,bottom],"rect":[X(xs[i]),Z(ys[j]),X(xs[right]),Z(ys[bottom])]})
    # A piece that is a crossed shaft box is not floor (the box can span several cells).
    leads_area={}
    for r in rectangles:leads_area[r["zone"]]=max(leads_area.get(r["zone"],0),(xs[r["grid"][2]]-xs[r["grid"][0]])*(ys[r["grid"][3]]-ys[r["grid"][1]]))
    piece_area=lambda g:(xs[g[2]]-xs[g[0]])*(ys[g[3]]-ys[g[1]])
    shaft=set()
    for k,r in enumerate(rectangles):
        if piece_area(r["grid"])>=leads_area[r["zone"]]:continue
        spans=[r["grid"]]+[[min(r["grid"][0],q["grid"][0]),min(r["grid"][1],q["grid"][1]),max(r["grid"][2],q["grid"][2]),max(r["grid"][3],q["grid"][3])]
                           for q in rectangles if q is not r and piece_area(q["grid"])<leads_area[q["zone"]]
                           and ((q["grid"][0]==r["grid"][0] and q["grid"][2]==r["grid"][2] and (q["grid"][1]==r["grid"][3] or q["grid"][3]==r["grid"][1]))
                                or (q["grid"][1]==r["grid"][1] and q["grid"][3]==r["grid"][3] and (q["grid"][0]==r["grid"][2] or q["grid"][2]==r["grid"][0])))]
        for g in spans:
            if _crossed(diagonal_ink,round(xs[g[0]]),round(ys[g[1]]),round(xs[g[2]]),round(ys[g[3]])):
                shaft.update(id(q) for q in rectangles if q["grid"][0]>=g[0] and q["grid"][2]<=g[2] and q["grid"][1]>=g[1] and q["grid"][3]<=g[3]);break
    rectangles=[r for r in rectangles if id(r) not in shaft]
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
        # A kitchen is furnished where its label is (its counter), if that piece is deep
        # enough; a corridor joined to it is not the kitchen.
        if seeds[r["zone"]]["type"]=="kitchen":
            i,j,ri,bj=r["grid"];sc=seeds[r["zone"]]["cell"]
            deep=min(r["rect"][2]-r["rect"][0],r["rect"][3]-r["rect"][1])>=KITCHEN_MIN_SIDE
            area=area*(3 if i<=sc[0]<ri and j<=sc[1]<bj else 1)*(1 if deep else .3)
        if r["zone"] not in leads or area>leads[r["zone"]][0]:
            leads[r["zone"]]=(area,rid)
    bedrooms=[(a,rid,z) for z,(a,rid) in leads.items() if seeds[z]["type"]=="bedroom"]
    master=max(bedrooms,default=(0,-1,-1))[2]
    rooms=[]
    for rid,r in enumerate(rectangles):
        seed=seeds[r["zone"]];lead=leads[r["zone"]][1]==rid
        kind=("master" if r["zone"]==master else seed["type"]) if lead else ("balcony" if seed["type"]=="balcony" else "hall")
        rid_name="bath2" if lead and kind=="bathroom" and not any(x["id"]=="bath2" for x in rooms) else "kitchen" if lead and kind=="kitchen" and not any(x["id"]=="kitchen" for x in rooms) else f"image-{rid}"
        if lead and kind=="bathroom" and rid_name!="bath2" and not any(x["id"]=="ensuite" for x in rooms):rid_name="ensuite";kind="ensuite"
        label={"living":"거실","kitchen":"주방·식당","master":"안방","bedroom":"침실","bathroom":"욕실","balcony":"발코니","entrance":"현관","dressroom":"드레스룸"}.get(seed["type"],"실내 공간")
        if seed.get("combinedUses"):label="거실·침실 겸용"
        rooms.append({"id":rid_name,"type":kind,"label":label,"rect":[round(v,4) for v in r["rect"]],"zone":f"image-zone-{r['zone']}","labelObserved":seed["observed"],"combinedUses":seed.get("combinedUses",[])})
    openings=[];seen=set();connections=set();leafless_doors=[]
    narrow_doorways=0
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
                # An entrance opens onto the hall; with no wall drawn there is no door.
                kind="door" if za!=zb and private and kinds-{"entrance"}&{"bedroom","bathroom","dressroom"} and .50<=measure(hi)-measure(lo)<=1.8 and supported else "open"
                intervals=[(lo,hi,kind)]
            else:
                minimum_door=.32 if not dimension_scale and not has_dimension_axis else .50
                # The entrance opens onto the hall; two wet rooms never open into each other.
                wet_pair=za!=zb and {seeds[za]["type"],seeds[zb]["type"]}<= {"bathroom","utility"}
                door_pair=bool(kinds&{"bedroom","bathroom","dressroom"})
                intervals=[] if wet_pair else [(l+a,l+b,"door" if za!=zb and door_pair and measure(l+b)-measure(l+a)<=1.8 else "open") for a,b in _runs(~solid) if measure(l+b)-measure(l+a)>=minimum_door]
                if "balcony" in kinds:
                    bold=thick[l:h,max(0,p-3):p+4] if vertical else thick[max(0,p-3):p+4,l:h]
                    glazing=[]
                    for a,b in _runs(bold.max(axis=1 if vertical else 0)==0):
                        if measure(l+b)-measure(l+a)>=.8:glazing.append((l+a,l+b,"window"))
                    intervals=[run for run in intervals if not any(min(run[1],w[1])-max(run[0],w[0])>.2*(run[1]-run[0]) for w in glazing)]+glazing
                elif za!=zb and kinds.issubset({"living","kitchen","bedroom","dressroom"}):
                    # Interior sliding frames are passable. Require an observed
                    # thin frame with no bold wall underneath, never a blank gap.
                    bold=thick[l:h,max(0,p-3):p+4] if vertical else thick[max(0,p-3):p+4,l:h]
                    thin_only=(bold.max(axis=1 if vertical else 0)==0)&solid
                    for a,b in _runs(thin_only):
                        if measure(l+b)-measure(l+a)>=.65:
                            intervals.append((l+a,l+b,"sliding_door"))
            for begin,end,kind in intervals:
                mid=(begin+end)/2
                _,_,ra,rb=min(parts,key=lambda part:max(part[0]-mid,0,mid-part[1]))
                if kind=="window" and seeds[rectangles[ra]["zone"]]["type"]=="balcony":ra,rb=rb,ra
                a,b=measure(begin),measure(end)
                hinge="start";swing=rooms[ra]["id"];leafless=False
                if kind=="door":
                    depth=max(12,round((end-begin)*.8));scores=[]
                    for endpoint in [round(begin),round(end)]:
                        for direction in [-1,1]:
                            near,far=sorted((p+direction*7,p+direction*depth))
                            patch=neutral[max(0,endpoint-4):endpoint+5,max(0,near):far] if vertical else neutral[max(0,near):far,max(0,endpoint-4):endpoint+5]
                            scores.append(float((patch>0).mean()) if patch.size else 0)
                    # A gap in a drawn wall is a door only where its leaf is drawn; a few
                    # pixels of misaligned wall line are not a doorway (bathroom mazes).
                    leafless=coverage>=.13 and max(scores)<.06
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
                width=b-a
                if width<.50:
                    # Retain the source gap exactly. A small symbolic door may
                    # connect rooms without supporting body-sized walking.
                    if kind!="door" or dimension_scale or has_dimension_axis or max(scores,default=0)<.08:continue
                    narrow_doorways+=1
                (leafless_doors if leafless else openings).append({"type":kind,"a":rooms[ra]["id"],"b":rooms[rb]["id"],"axis":axis,"at":round(X(at) if vertical else Z(at),4),"center":round((a+b)/2,4),"width":round(width,4),"height":2.7 if kind=="open" else 1.6 if kind=="window" else 2.1,"sill":.55 if kind=="window" else 0,"hinge":hinge,"swingInto":swing,**({"_leaf":max(scores)} if kind=="door" else {})})
    # A room left with no way in keeps its most door-like leafless gap.
    zone_of={r["id"]:r["zone"] for r in rooms}
    for zone in {r["zone"] for r in rooms if r["type"] in ("bedroom","master","bathroom","ensuite","dressroom")}:
        if any(o["b"]!="out" and o["type"]!="window" and zone in (zone_of[o["a"]],zone_of[o["b"]]) and zone_of[o["a"]]!=zone_of[o["b"]] for o in openings):continue
        candidates=[o for o in leafless_doors if zone in (zone_of[o["a"]],zone_of[o["b"]])]
        if candidates:openings.append(max(candidates,key=lambda o:(o["_leaf"],o["width"])))
    # A bathroom has one door. A second "door" is its leaf's corner read through a
    # neighbouring wall line; keep the one whose leaf is drawn most clearly.
    for zone in {r["zone"] for r in rooms if r["type"] in ("bathroom","ensuite")}:
        doors=[o for o in openings if o["type"]=="door" and zone in (zone_of[o["a"]],zone_of.get(o["b"])) and zone_of[o["a"]]!=zone_of.get(o["b"])]
        if len(doors)>1:
            # (a shared bathroom opens onto the hall, an en-suite onto its bedroom)
            other=lambda o:seeds[int(zone_of[o["b"] if zone_of[o["a"]]==zone else o["a"]].rsplit("-",1)[1])]["type"]
            rank={"living":2,"kitchen":2,"bedroom":1,"dressroom":1}
            keep=max(doors,key=lambda o:(rank.get(other(o),0),o.get("_leaf",0),o["width"]))
            openings=[o for o in openings if o not in doors or o is keep]
    # A bathroom door is a door, not a missing wall: an unread wall line left whole
    # sides open as 1.7 m "doors" whose swing left no room for the toilet or basin.
    for o in openings:
        if o["type"]=="door" and o["width"]>.9 and any(zone_of.get(k) in {r["zone"] for r in rooms if r["type"] in ("bathroom","ensuite")} for k in (o["a"],o["b"])):
            o["width"]=.8
    for o in openings:o.pop("_leaf",None)
    # Recover an exterior entrance spanning several rectangles (the image's door leaf
    # is perpendicular to the wall, unlike a parallel window frame). No invented hole.
    entrance_sides=[]
    # An entrance set back in a notch has its front door on its own outside wall,
    # not on the drawing's bounding line.
    for rid,r in enumerate(rectangles):
        if seeds[r["zone"]]["type"]!="entrance":continue
        i,j,ri,bj=r["grid"]
        for axis,at,lo,hi,outward,beyond in [("x",xs[i],ys[j],ys[bj],-1,[(i-1,k) for k in range(j,bj)]),("x",xs[ri],ys[j],ys[bj],1,[(ri,k) for k in range(j,bj)]),
                                             ("z",ys[j],xs[i],xs[ri],-1,[(k,j-1) for k in range(i,ri)]),("z",ys[bj],xs[i],xs[ri],1,[(k,bj) for k in range(i,ri)])]:
            if not any(c in cell_room for c in beyond):entrance_sides.append((axis,at,round(lo),round(hi),outward))
    for axis,at,lo,hi,outward in [("z",ys[0],round(xs[0]),round(xs[-1]),-1),("z",ys[-1],round(xs[0]),round(xs[-1]),1),("x",xs[0],round(ys[0]),round(ys[-1]),-1),("x",xs[-1],round(ys[0]),round(ys[-1]),1)]+entrance_sides:
        vertical=axis=="x";p=round(at);measure=Z if vertical else X
        bold=thick[lo:hi,max(0,p-4):p+5] if vertical else thick[max(0,p-4):p+5,lo:hi]
        frame=neutral[lo:hi,max(0,p-3):p+4] if vertical else neutral[max(0,p-3):p+4,lo:hi]
        if not bold.size:continue
        solid=bold.max(axis=1 if vertical else 0)>0;thin=frame.max(axis=1 if vertical else 0)>0
        for begin,end in _runs(~solid):
            a,b=measure(lo+begin),measure(lo+end)
            if not .55<=b-a<=1.3 or begin<5 or end>len(solid)-5:continue
            depth=max(15,round((end-begin)*.8))
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
            if any(o["type"]=="front_door" and o["axis"]==axis and abs(o["at"]-(X(at) if vertical else Z(at)))<.01 and abs(o["center"]-(a+b)/2)<.3 for o in openings):continue
            openings.append({"type":"front_door","a":rooms[rid]["id"],"b":"out","axis":axis,"at":round(X(at) if vertical else Z(at),4),"center":round((a+b)/2,4),"width":round(b-a,4),"height":2.1,"sill":0,"hinge":"end" if leaf[1]>leaf[0] else "start","swingInto":rooms[rid]["id"],"_leaf":max(leaf)})
    # A flat has one front door: the most clearly drawn leaf.
    fronts=[o for o in openings if o["type"]=="front_door"]
    if fronts:
        keep=max(fronts,key=lambda o:o["_leaf"])
        openings=[o for o in openings if o["type"]!="front_door" or o is keep];keep.pop("_leaf")
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
    # A kitchen larger than the living room is never a real Korean flat: it is a misread.
    zone_area=lambda kind:sum((r["rect"][2]-r["rect"][0])*(r["rect"][3]-r["rect"][1]) for rid,r in enumerate(rooms) if seeds[rectangles[rid]["zone"]]["type"]==kind and not seeds[rectangles[rid]["zone"]].get("combinedUses"))
    kitchen_area,living_area=zone_area("kitchen"),zone_area("living")
    kitchen_within_living=not living_area or kitchen_area<=living_area
    error=counted/exclusive_area-1
    usable_beds=all(min(rooms[rid]["rect"][2]-rooms[rid]["rect"][0],rooms[rid]["rect"][3]-rooms[rid]["rect"][1])>=1.9 for _,rid,_ in bedrooms)
    living_id=next((r["id"] for r in rooms if r["type"]=="living"),None)
    zone_by_id={r["id"]:r["zone"] for r in rooms}
    reachable={zone_by_id[living_id]} if living_id else set()
    for _ in rooms:
        before=len(reachable)
        for opening in openings:
            # Walker's diameter is 0.48 m; reject passages below that plus a margin.
            if opening["b"]=="out" or opening["type"]=="window" or opening["width"]<.30:continue
            a,b=zone_by_id[opening["a"]],zone_by_id[opening["b"]]
            if a in reachable:reachable.add(b)
            if b in reachable:reachable.add(a)
        if len(reachable)==before:break
    connected=all(r["zone"] in reachable for r in rooms if r["type"] in ("living","kitchen","master","bedroom","bathroom","ensuite"))
    # A source marked GA3 contains converted balcony/service floor. Its measured
    # interior is legitimately larger than the registered exclusive area. Validate
    # it against its own documented supply envelope, retaining the actual geometry.
    expanded_area=bool(expanded and dimension_scale and supply_area and exclusive_area*.82<=counted<=min(exclusive_area*1.45,supply_area*1.05))
    # Room dimensions and logical doorway connectivity remain diagnostics. A
    # structurally matched original can enter furnished 3D review even when its
    # small printed door symbol is too narrow for body-sized walking.
    status="ready" if (abs(error)<.25 or expanded_area) and (len(bedrooms)>=1 or combined_sleep) and kitchen_within_living else "needs_review"
    source_floor=(enclosed>0) if monochrome else (hsv[:,:,1]>25)&(gray>90)
    source_floor[:y0]=False;source_floor[y1+1:]=False;source_floor[:,:x0]=False;source_floor[:,x1+1:]=False
    match=source_match(wall,rooms,openings,xs,ys,rectangles,(x0,y0,x1,y1),source_floor)
    # Reconstruction can omit long walls even when its area and room count look
    # plausible. Do not admit such a model as a source-based interior.
    if status=="ready" and (match["wallF1"]<.80 or match["floorCoverage"]<.95):status="needs_review"
    elapsed=round((time.perf_counter()-started)*1000)
    distance=cv2.distanceTransform(thick,cv2.DIST_L2,5)
    thickness=[]
    for axis,coordinates in [("x",xs),("z",ys)]:
        for coordinate in coordinates[1:-1]:
            at=round(coordinate)
            patch=distance[y0:y1+1,max(0,at-3):at+4] if axis=="x" else distance[max(0,at-3):at+4,x0:x1+1]
            widths=patch.max(axis=1 if axis=="x" else 0)*2
            widths=widths[(widths>=2)&(widths<=30)]
            if len(widths)>=minimum:thickness.append(float(np.median(widths))*(sx if axis=="x" else sy))
    wall_thickness=float(np.median(thickness)) if thickness else 2*float(np.median(distance[distance>0]))*min(sx,sy)
    result={"status":status,"reason":None if status=="ready" else "kitchen_exceeds_living" if not kitchen_within_living else "source_wall_mismatch" if match["wallF1"]<.80 else "source_floor_mismatch" if match["floorCoverage"]<.95 else "area_or_room_consistency","version":VERSION,
            "imageSize":[W,H],"pixelBounds":[int(x0),int(y0),int(x1),int(y1)],"scale":{"xMetresPerPixel":sx,"zMetresPerPixel":sy,"basis":"dimension_chains" if chain_applied else "single_axis_dimensions" if single_axis else "recognized_dimensions" if dimension_scale else "room_area_ratio" if area_scale_applied else "exclusive_area_ratio","estimated":not dimension_scale or single_axis,"sourceAspectRatio":round((x1-x0)/(y1-y0),6),"wallThicknessMetres":round(max(.02,min(.4,wall_thickness)),4)},
            "dimensionConstraints":x_constraints+z_constraints,"dimensionChainsApplied":chain_applied,
            "recognizedAreas":area_evidence,"areaConstraints":area_constraints,"sourceMatch":match,
            "pixelRooms":[{"id":rooms[rid]["id"],"rect":[xs[r["grid"][0]],ys[r["grid"][1]],xs[r["grid"][2]],ys[r["grid"][3]]]} for rid,r in enumerate(rectangles)],
            "recognizedDimensions":[{k:d[k] for k in ("text","millimetres","x","y","rotation","confidence")} for d in numeric],
            "rooms":rooms,"openings":openings,"areaM2":round(counted,2),"areaError":round(error,4),"elapsedMs":elapsed,
            "areaBasis":"expanded_drawing" if expanded_area else "exclusive_area",
            "application":{"mode":"approximate_source" if area_annotation_conflict or abs(error)>=.18 or not match['targetMet'] or not usable_beds or not connected else "source","areaAnnotationAdjusted":area_annotation_conflict,"geometryBasis":"original_image","templateUsed":False,"areaRebalancedCells":rebalanced},
            "checks":{"areaConsistent":abs(error)<.18 or expanded_area,"roomAreasConsistent":not area_annotation_conflict,"bedroomsUsable":usable_beds,"connected":connected,"narrowDoorways":narrow_doorways,"kitchenWithinLiving":kitchen_within_living},
            "note":"원본 이미지의 벽·방 위치를 인식한 모델입니다. 도면 치수 인식과 공간 구분에 오차가 있을 수 있으며 가구·마감은 연출입니다."+(" 확장형의 발코니 확장 면적이 포함되어 계산된 실내 면적은 전용면적과 다릅니다." if expanded_area else "")+(" 치수 없는 공간은 면적과 원본 가로·세로 비율로 환산했습니다. 실측 치수가 아니며 면적 일치는 독립적인 정확도 검증이 아닙니다." if not dimension_scale else "")+(" 작은 문 기호의 환산 폭을 보존했으며 좁은 통로도 이동할 수 있습니다." if narrow_doorways else "")}
    if area_annotation_conflict:result['note']+=' 방별 면적 표기 차이는 전용면적을 기준으로 축척 보정했으며 원본 방 배치와 벽 위치는 유지했습니다.'
    if (status=='needs_review' and result['reason']=='area_or_room_consistency' and .25<=error<=1
            and match['wallF1']>=.80 and match['floorCoverage']>=.95 and (bedrooms or combined_sleep)):
        # Some basic-labelled sources actually include expanded floor, or their
        # dimension chains are OCR-scaled inconsistently. Preserve original pixel
        # geometry and use ONE explicitly estimated exclusive-area scale instead.
        # Never repair an unreadable source or invent missing rooms/walls here.
        outside={r['zone'] for r in rooms if r['type'] in ('balcony','utility')}
        pixel_area=sum((p['rect'][2]-p['rect'][0])*(p['rect'][3]-p['rect'][1]) for p,r in zip(result['pixelRooms'],rooms) if r['zone'] not in outside)
        calibrated=math.sqrt(exclusive_area/pixel_area)
        wx=[X(v) for v in xs];wz=[Z(v) for v in ys]
        px=lambda v:float(np.interp(v,wx,xs))
        pz=lambda v:float(np.interp(v,wz,ys))
        for room,pixel in zip(rooms,result['pixelRooms']):
            a,b,c,d=pixel['rect'];room['rect']=[round((a-x0)*calibrated,4),round((b-y0)*calibrated,4),round((c-x0)*calibrated,4),round((d-y0)*calibrated,4)]
        for opening in openings:
            along=pz if opening['axis']=='x' else px;across=px if opening['axis']=='x' else pz
            origin=y0 if opening['axis']=='x' else x0
            a=along(opening['center']-opening['width']/2);b=along(opening['center']+opening['width']/2)
            opening.update(at=round((across(opening['at'])-(x0 if opening['axis']=='x' else y0))*calibrated,4),center=round(((a+b)/2-origin)*calibrated,4),width=round((b-a)*calibrated,4))
        result.update(status='ready',reason=None,areaM2=round(exclusive_area,2),areaError=0,areaBasis='exclusive_area',dimensionChainsApplied=False)
        result['scale'].update(xMetresPerPixel=calibrated,zMetresPerPixel=calibrated,basis='exclusive_area_ratio',estimated=True,wallThicknessMetres=round(max(.02,min(.4,wall_thickness*calibrated/math.sqrt(sx*sy))),4))
        result['application'].update(mode='approximate_source',areaAnnotationAdjusted=True,dimensionScaleAdjusted=True)
        result['checks'].update(areaConsistent=True,roomAreasConsistent=False)
        result['note']+=' 도면 치수 판독과 구성 면적의 차이로 원본 픽셀 배치를 유지한 전용면적·가로세로 비율 축척을 적용했습니다. 적용 치수는 실측값이 아닙니다.'
    result['_recoveryWords']=recognized_words
    return result


def analyze_image(data:bytes,exclusive_area:float,*,words:list[dict]|None=None,expanded:bool=False,supply_area:float|None=None,_axis_recovery:bool=False)->dict:
    started=time.perf_counter()
    result=_analyze_image(data,exclusive_area,words=words,expanded=expanded,supply_area=supply_area,_axis_recovery=_axis_recovery)
    recovered_words=result.pop('_recoveryWords',None)
    match=result.get('sourceMatch')
    # Return from the first pass before allocating another full image graph.
    # Its native masks/labels can be reclaimed/reused rather than coexisting.
    if not _axis_recovery and match and not match['targetMet']:
        alternative=_analyze_image(data,exclusive_area,words=recovered_words,expanded=expanded,supply_area=supply_area,_axis_recovery=True)
        alternative.pop('_recoveryWords',None)
        if alternative.get('status')=='ready' and alternative.get('sourceMatch',{}).get('wallF1',0)>match['wallF1']:result=alternative
    # Evidence-based corrections of leftover cells and edges past the drawn floor (floorplan_refine).
    if result.get('rooms'):
        try:
            from app.services.floorplan_refine import refine
            image=cv2.imdecode(np.frombuffer(data,np.uint8),cv2.IMREAD_COLOR)
            if image is not None:result=refine(result,image)
        except Exception:pass   # (the uncorrected analysis stands)
    result['elapsedMs']=round((time.perf_counter()-started)*1000)
    return result
