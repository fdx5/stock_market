"""Import the freely published LH drawing archive into the read-only public reference catalogue.

No DB connection or writes. No inferred address/complex matching and no wall extraction from images.
Pass the downloaded public ZIP path; the source is data.go.kr dataset 15037046, PART-2 (20210915).
"""
import argparse,base64,csv,hashlib,io,json,re,unicodedata,zipfile
from pathlib import Path
from PIL import Image

def norm(s):return ''.join(c for c in unicodedata.normalize('NFKC',s) if c.isalnum())

def main():
 p=argparse.ArgumentParser();p.add_argument('archive',type=Path);args=p.parse_args()
 out=Path(__file__).resolve().parents[1]/'frontend/public/3d/walk/plans';out.mkdir(parents=True,exist_ok=True)
 records=[];unmatched=[]
 with zipfile.ZipFile(args.archive) as z:
  members=[n for n in z.namelist() if n.lower().endswith('.json')]
  csvname=next(n for n in z.namelist() if n.lower().endswith('.csv'))
  text=z.read(csvname).decode('cp949');rows=list(csv.DictReader(text.splitlines()))
  for row in rows:
   values=list(row.values());region,project,block,unit,supply,dongs,label,total,exclusive,filename=values[:10]
   candidates=[n for n in members if Path(n).name==filename and norm(project) in norm(n.rsplit('/',1)[0]) and norm(block) in norm(n.rsplit('/',1)[0])]
   if not candidates:
    root=norm(re.sub(r'\([^)]*\)','',project)).removesuffix('BL')
    if root.lower().endswith(norm(block).lower()):root=root[:-len(norm(block))]
    tokens=re.findall(r'[A-Za-z]+|\d+',block)
    block_re=re.compile(r'(?<![A-Za-z0-9])'+r'[\W_]*'.join(('0*'+str(int(t))) if t.isdigit() else re.escape(t) for t in tokens)+r'(?:BL)?(?![A-Za-z0-9])',re.I)
    candidates=[n for n in members if Path(n).name==filename and root in norm(n.rsplit('/',1)[0]) and block_re.search(n.rsplit('/',1)[0])]
   if len(candidates)!=1:unmatched.append({'project':project,'block':block,'file':filename,'matches':len(candidates)});continue
   member=candidates[0];raw=z.read(member).decode('utf-8-sig',errors='strict')
   found=re.search(r'data:image/(?:jpg|jpeg|png);base64,([A-Za-z0-9+/=\s]+)',raw)
   payload=found[1] if found else None
   if payload is None:
    try:
     image_info=json.loads(raw).get('image',{})
     if image_info.get('mime') in ('image/jpeg','image/jpg','image/png'):payload=image_info.get('data')
    except (ValueError,AttributeError):pass
   if not isinstance(payload,str):unmatched.append({'project':project,'file':filename,'reason':'unrecognised image encoding'});continue
   data=base64.b64decode(re.sub(r'\s','',payload),validate=True)
   image=Image.open(io.BytesIO(data));assert image.width*image.height<80_000_000
   key='lh-'+hashlib.sha256(member.encode('utf-8')).hexdigest()[:16]
   target=out/(key+'.webp')
   if not target.exists():image.convert('RGB').save(target,'WEBP',quality=96,method=4)
   records.append({'id':key,'region':region,'project':project,'block':block,'unitType':label or unit,'exclusiveArea':float(exclusive or 0),'supplyArea':float(total or 0),'dongs':dongs.split(),'tenure':supply,
    'image':'/3d/walk/plans/'+target.name,'width':image.width,'height':image.height,'source':'한국토지주택공사 공개 평면도','sourceUrl':'https://www.data.go.kr/data/15037046/fileData.do','sourceDate':'2021-09-15','sourceFile':filename,'sourceMember':member})
 payload={'source':'한국토지주택공사 주택 평면도 현황','sourceUrl':'https://www.data.go.kr/data/15037046/fileData.do','sourceDate':'2021-09-15','license':'이용허락범위 제한 없음','note':'공개된 주택형 참고 도면. 현재 단지·동·라인과 일치 여부는 별도 확인이 필요하며 이미지에서 내부 치수를 추정하지 않습니다.','count':len(records),'plans':records}
 (out/'index.json').write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
 print(json.dumps({'imported':len(records),'unmatchedCount':len(unmatched),'unmatchedSample':unmatched[:5],'imageBytes':sum(f.stat().st_size for f in out.glob('*.webp'))},ensure_ascii=True))

if __name__=='__main__':main()
