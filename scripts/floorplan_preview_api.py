"""Read-only local apartment drawing API. No main-app startup, DB, login or scheduled jobs.

Run: python scripts/floorplan_preview_api.py (after frontend npm install).
"""
import base64,csv,io,json,shutil,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
import cv2
from fastapi import FastAPI,HTTPException,Query,Response
from app.services import realestate_floorplans as plans
from app.services import floorplan_image_analysis as interpretation

def wasm_ocr(image,rotation=0,mode="mixed"):
 if rotation:image=cv2.rotate(image,cv2.ROTATE_90_CLOCKWISE)
 image=cv2.resize(image,None,fx=3,fy=3,interpolation=cv2.INTER_CUBIC)
 encoded=cv2.imencode('.png',image)[1].tobytes()
 result=subprocess.run(['node',str(ROOT/'scripts/floorplan_ocr.cjs')],input=json.dumps({'png':base64.b64encode(encoded).decode(),'rotation':rotation,'mode':mode}).encode(),capture_output=True,timeout=25,check=True)
 tsv=json.loads(result.stdout)['tsv'];fields=['level','page_num','block_num','par_num','line_num','word_num','left','top','width','height','conf','text'];words=[]
 for row in csv.DictReader(tsv.splitlines(),fieldnames=fields,delimiter='\t'):
  if row.get('level')!='5' or float(row['conf'])<25 or not row['text'].strip():continue
  x,y,w,h=[float(row[k])/3 for k in ['left','top','width','height']];cx,cy=x+w/2,y+h/2
  if rotation:cx,cy=cy,image.shape[1]/3-cx;w,h=h,w
  words.append({'text':row['text'],'x':cx,'y':cy,'w':w,'h':h,'confidence':float(row['conf']),'rotation':rotation})
 return words

if not shutil.which('tesseract'):interpretation._ocr=wasm_ocr
app=FastAPI(docs_url=None,redoc_url=None)
@app.get('/api/health')
def health():return {'status':'ok','mode':'read-only-apartment-preview','database':False}
@app.get('/api/realestate/floor-plans')
def catalogue(name:str,lat:float,lon:float,town:str='',region:str=''):
 return plans.catalogue(name,lat,lon,town,region)
@app.get('/api/realestate/floor-plan-analysis')
def analyze(naver_id:str=Query(pattern=r'^\d{1,10}$'),key:str=Query(pattern=r'^[a-f0-9]{24}$')):
 try:return plans.analyze(naver_id,key)
 except Exception as exc:raise HTTPException(502,type(exc).__name__) from None
@app.get('/api/realestate/floor-plan-image')
def image(naver_id:str=Query(pattern=r'^\d{1,10}$'),key:str=Query(pattern=r'^[a-f0-9]{24}$')):
 try:data,mime=plans.image(naver_id,key);return Response(data,media_type=mime)
 except Exception:raise HTTPException(502,'drawing unavailable') from None
if __name__=='__main__':
 import uvicorn
 uvicorn.run(app,host='127.0.0.1',port=8012,log_level='warning')
