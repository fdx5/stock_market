"""Create an isolated, read-only 4K export page from a regional film profile."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import re
import shutil

parser=argparse.ArgumentParser()
parser.add_argument('--profile',type=Path,required=True)
parser.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[2])
parser.add_argument('--ffmpeg',type=Path)
parser.add_argument('--port',type=int)
args=parser.parse_args()
kit=Path(__file__).resolve().parent
repo=args.repo.resolve();frontend=repo/'frontend'
profile=json.loads(args.profile.read_text(encoding='utf-8'))
assert re.fullmatch(r'[a-z0-9-]+',profile['id']), 'Use a lowercase ASCII profile ID'
v=profile['video'];assert v['width']>=3840 and v['height']>=2160 and v['fps']==60
assert v['seconds']>0 and v['seconds']*v['fps']==round(v['seconds']*v['fps'])
assert profile['minAltitude']<profile['maxAltitude'] and profile['minSpeed']<profile['maxSpeed']
assert len(profile['shots'])>=2
audio=Path(profile['music']['file']);audio=audio if audio.is_absolute() else repo/audio
assert audio.is_file(), 'Supply a music file whose use is authorized'
if args.ffmpeg:ffmpeg=args.ffmpeg.resolve()
else:
 import imageio_ffmpeg
 ffmpeg=Path(imageio_ffmpeg.get_ffmpeg_exe())
assert ffmpeg.is_file()
assert (frontend/'node_modules/vite/bin/vite.js').is_file(), 'Install frontend dependencies first'
assert 'frame?.pixelRatio' in (frontend/'src/components/droneSigns.ts').read_text(encoding='utf-8'), 'Use the repository version containing this film kit and its DroneSigns export options'
job=profile['id']+'-'+datetime.now().strftime('%Y%m%d-%H%M%S')
out=repo/'output'/job;out.mkdir(parents=True,exist_ok=False)
qa=frontend/'qa'/job;qa.mkdir(parents=True,exist_ok=False)
port=args.port or profile.get('port',5200)
shutil.copy2(audio,out/('music-source'+audio.suffix))
audio=out/('music-source'+audio.suffix)
profile['music']['file']=str(audio)
(out/'preset.json').write_text(json.dumps(profile,ensure_ascii=False,indent=2),encoding='utf-8')
shutil.copy2(out/'preset.json',qa/'preset.json')
main=(kit/'templates/main.template.tsx').read_text(encoding='utf-8')
main=re.sub(r'<b>.*?</b><p>.*?</p><button', '<b>{preset.center.title} · {W}×{H} / {FPS}fps / {DURATION}s</b><p>반경 {preset.radius}m · 고도 {preset.minAltitude}–{preset.maxAltitude}m</p><button',main,count=1)
(qa/'main.tsx').write_text(main,encoding='utf-8')
page=(kit/'templates/page.template.html').read_text(encoding='utf-8')
page=page.replace('/qa/haeundae-film/main.tsx',f'/qa/{job}/main.tsx')
page_name=f'.local-film-{job}.html';(frontend/page_name).write_text(page,encoding='utf-8')
server=(kit/'templates/server.template.ts').read_text(encoding='utf-8')
server=server.replace("import base from './.local-drone-review.config'", "import base from './vite.config'")
server=re.sub(r"const output=path.resolve\(.*?\);",'const output='+json.dumps(str(out).replace('\\','/'))+';',server)
server=re.sub(r"const ffmpeg=.*?;",'const ffmpeg='+json.dumps(str(ffmpeg).replace('\\','/'))+';',server)
server=server.replace("path.join(output,'inception.webm')",json.dumps(str(audio).replace('\\','/')))
server=server.replace("'-t','162'", "'-t',"+json.dumps(str(v['seconds'])))
server=server.replace('st=160.5','st='+str(v['seconds']-1.5)).replace('frame>9720',f"frame>{round(v['seconds']*v['fps'])}")
server=server.replace('title=HAEUNDAE / THE ZENITH','title='+profile['title'])
server=server.replace('Music: Inception - Angel Lover.','Music: '+profile['music']['title']+'.')
api=profile.get('apiOrigin','https://kospimap.com')
proxy=json.dumps({'/api/realestate':{'target':api,'changeOrigin':True},'/api':{'target':api,'changeOrigin':True}})
server=server.replace('server:{port:5200,strictPort:true,hmr:false}',f"server:{{host:'127.0.0.1',port:{port},strictPort:true,hmr:false,proxy:{proxy}}}")
guard="""server.middlewares.use((req,res,next)=>{res.setHeader('Content-Security-Policy',\"frame-src 'none'; media-src 'none'\");if(req.url?.startsWith('/api/')&&!['GET','HEAD'].includes(req.method||'')){res.statusCode=405;res.end('Read-only film preview');return;}next();});"""
server=server.replace("configureServer(server){server.middlewares.use('/__film'", "configureServer(server){"+guard+"server.middlewares.use('/__film'")
config_name=f'.local-film-{job}.config.ts';(frontend/config_name).write_text(server,encoding='utf-8')
url=f'http://127.0.0.1:{port}/{page_name}?fps=1'
(out/'launch.json').write_text(json.dumps({'url':url,'frontend':str(frontend),'config':config_name,'qa':str(qa),'created':datetime.now().isoformat()},indent=2),encoding='utf-8')
start=f"$ErrorActionPreference='Stop'\nSet-Location -LiteralPath '{frontend}'\n& node node_modules/vite/bin/vite.js --config '{config_name}'\n"
(out/'start.ps1').write_text(start,encoding='utf-8-sig')
print(json.dumps({'output':str(out),'start':str(out/'start.ps1'),'url':url},ensure_ascii=True,indent=2))
