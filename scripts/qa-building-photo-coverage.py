"""Read-only public photo coverage probes. No PNU, stored DB, auth or admin requests."""
import argparse
import concurrent.futures as cf
import json
from pathlib import Path
import time
from urllib.parse import urlparse
import requests

parser=argparse.ArgumentParser()
parser.add_argument('--origin',default='https://kospimap.com')
parser.add_argument('--out',type=Path,required=True)
parser.add_argument('--variants',action='store_true')
args=parser.parse_args()
if args.out.exists():raise SystemExit('Use a fresh report path.')
cases=[('해운대두산위브더제니스',35.15661,129.14506,'우동'),
       ('더#해운대아델리스',35.1535,129.1459,'우동'),
       ('해운대 아이파크',35.1554,129.1454,'우동'),
       ('한성기린',35.1745,129.116,'망미동'),
       ('부산광역시청',35.17974,129.07515,'연산동')]
if args.variants:
    cases=[('더샵 해운대 아델리스',35.1535,129.1459,'우동'),
           ('해운대 아델리스',35.1535,129.1459,'우동'),
           ('한성기린아파트',35.1745,129.116,'망미동'),
           ('망미동 한성기린',35.1745,129.116,''),
           ('한성기린',35.1745,129.116,'')]
def probe(c):
    session=requests.Session();session.trust_env=False;started=time.monotonic()
    try:
        r=session.get(args.origin+'/api/realestate/building-info',params={'name':c[0],'lat':c[1],'lon':c[2],'area':c[3]},timeout=60)
        r.raise_for_status();j=r.json();photos=j.get('photos') or []
        return {'name':c[0],'httpStatus':r.status_code,'seconds':round(time.monotonic()-started,2),
                'wiki':j.get('wiki'),'photoCount':len(photos),'photos':photos,'sources':j.get('sources'),
                'photoHosts':[urlparse(x.get('thumb') or '').hostname for x in photos]}
    except Exception as e:return {'name':c[0],'error':type(e).__name__}
with cf.ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(probe,cases))
args.out.parent.mkdir(parents=True,exist_ok=True)
args.out.write_text(json.dumps({'origin':args.origin,'cases':results},ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps([{k:v for k,v in row.items() if k not in ('photos','wiki')}|{'wiki':bool(row.get('wiki'))} for row in results],ensure_ascii=True),flush=True)
