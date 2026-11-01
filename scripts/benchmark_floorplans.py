"""Read-only, repeatable original-image comparison. Never imports app startup or a DB.

Example: python scripts/benchmark_floorplans.py --fixtures tmp/large-floors
`ready` is an automatic validation rate, never ground-truth recognition accuracy.
Public-image OCR observations are cached separately for reproducible comparisons.
"""
import argparse
import hashlib
import io
import json
import subprocess
import sys
import types
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'backend'))
sys.path.insert(0, str(ROOT/'scripts'))
from app.services import floorplan_image_analysis as candidate
from app.services.realestate_floorplans import parse_gallery
from floorplan_preview_api import wasm_ocr


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixtures', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT/'tmp/floorplan-upgrade-20261101')
    parser.add_argument('--baseline-ref', default='6f8f687d')
    parser.add_argument('--without-dimensions', action='store_true', help='Whiten only the exterior annotation margins; preserve every original interior pixel.')
    parser.add_argument('--extra-catalogue', action='append', default=[], help='prefix=path.json; matching prefix-type.jpg images reside next to this catalogue.')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    ocr_dir = args.output/'ocr'
    ocr_dir.mkdir(exist_ok=True)
    native_ocr = candidate._ocr
    import shutil
    def cached_ocr(im, rotation=0, mode='mixed'):
        key = hashlib.sha256(im.tobytes()+str(im.shape).encode()+f'{rotation}:{mode}'.encode()).hexdigest()
        path = ocr_dir/(key+'.json')
        if path.exists():
            return json.loads(path.read_text(encoding='utf8'))
        words = native_ocr(im, rotation, mode) if shutil.which('tesseract') else wasm_ocr(im, rotation, mode)
        path.write_text(json.dumps(words, ensure_ascii=False), encoding='utf8')
        return words
    baseline = types.ModuleType('floorplan_baseline')
    exec(subprocess.check_output(['git','show',args.baseline_ref+':backend/app/services/floorplan_image_analysis.py'], cwd=ROOT).decode('utf8'), baseline.__dict__)
    baseline.__file__ = candidate.__file__
    baseline._ocr = candidate._ocr = cached_ocr
    catalogues = {}
    raw = json.loads((args.fixtures/'naver-plans-utf8.json').read_text(encoding='utf8'))
    catalogues['naver'] = parse_gallery("var imgInfoData = '"+json.dumps(raw)+"';", '2127')
    for name in ['desiang','luceheim']:
        catalogues[name] = json.loads((args.fixtures/(name+'-catalogue.json')).read_text(encoding='utf8'))
    directories={name:args.fixtures for name in catalogues}
    for item in args.extra_catalogue:
        prefix,path=item.split('=',1);path=Path(path)
        catalogues[prefix]=json.loads(path.read_text(encoding='utf8'));directories[prefix]=path.parent
    results = []
    for prefix, catalogue in catalogues.items():
        for image in sorted(directories[prefix].glob(prefix+'-*.jpg')):
            name = image.stem[len(prefix)+1:]
            plan = next((p for p in catalogue['plans'] if p['typeName'] == name), None)
            if plan is None:
                continue
            data=image.read_bytes()
            if args.without_dimensions:
                reference=json.loads((args.output.parent/(image.stem+'-baseline.json')).read_text(encoding='utf8'))
                x0,y0,x1,y1=reference['pixelBounds']
                im=Image.open(io.BytesIO(data)).convert('RGB');draw=ImageDraw.Draw(im)
                draw.rectangle((0,0,im.width,y0-3),fill='white')
                draw.rectangle((0,y1+3,im.width,im.height),fill='white')
                draw.rectangle((0,0,x0-3,im.height),fill='white')
                draw.rectangle((x1+3,0,im.width,im.height),fill='white')
                encoded=io.BytesIO();im.save(encoded,format='PNG');data=encoded.getvalue()
            record = {'case':image.stem, 'sourceSha256':hashlib.sha256(image.read_bytes()).hexdigest(), 'drawing':plan}
            for label, module in [('baseline',baseline),('candidate',candidate)]:
                a = module.analyze_image(data, plan['exclusiveArea'], expanded=plan['variant']=='평면도 확장형', supply_area=plan['supplyArea'])
                record[label] = {k:a.get(k) for k in ['status','reason','scale','areaM2','areaError','sourceMatch','elapsedMs']}
                (args.output/(image.stem+'-'+label+'.json')).write_text(json.dumps({**a,'drawing':plan},ensure_ascii=False,indent=2), encoding='utf8')
            results.append(record)
            print(json.dumps({k:record[k] for k in ['case','baseline','candidate']},ensure_ascii=True),flush=True)
    report = {'cases':len(results), 'baselineReady':sum(r['baseline']['status']=='ready' for r in results),
              'candidateReady':sum(r['candidate']['status']=='ready' for r in results),
              'withoutDimensions':args.without_dimensions, 'metric':'automatic_validation_rate_not_ground_truth_accuracy', 'results':results}
    (args.output/'benchmark.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({k:v for k,v in report.items() if k!='results'}),flush=True)


if __name__ == '__main__':
    main()
