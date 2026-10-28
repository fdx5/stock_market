"""Prepare licensed field recordings for the walk. No synthesized engine tracks.
Source originals stay in tmp/car-audio-source; only trimmed game clips ship.
"""
import io,json,subprocess,urllib.request,zipfile
from pathlib import Path
import numpy as np
import soundfile as sf
import imageio_ffmpeg

ROOT=Path(__file__).resolve().parents[2];SRC=ROOT/'tmp/car-audio-source';OUT=ROOT/'frontend/public/3d/walk/cars/audio';OUT.mkdir(parents=True,exist_ok=True)
FFMPEG=imageio_ffmpeg.get_ffmpeg_exe();RATE=48000;credits={}
def source(name,sid,page,author='Joseph SARDIN'):
    path=SRC/(name+'.mp3')
    if not path.exists():path.write_bytes(urllib.request.urlopen('https://lasonotheque.org/UPLOAD/mp3/'+sid+'.mp3',timeout=45).read())
    credits[name]={'page':page,'license':'CC0-1.0','author':author,'source_id':sid};return path
files={
 'small':source('petrol-small','0966','https://bigsoundbank.com/small-gasoline-engine-s0966.html'),
 'van':source('diesel-van','0967','https://bigsoundbank.com/big-diesel-engine-s0967.html'),
 'iveco':source('truck-iveco','1145','https://bigsoundbank.com/truck-engine-s1145.html'),
 'heavy':source('truck-heavy','1442','https://bigsoundbank.com/truck-engine-1-s1442.html'),
 'rev':source('petrol-rev','0291','https://bigsoundbank.com/car-engine-2-s0291.html'),
 'cobra':source('sport-cobra','0534','https://bigsoundbank.com/ac-cobra-engine-s0534.html'),
 'diesel-rev':source('diesel-rev','1147','https://bigsoundbank.com/truck-engine-big-accelerations-s1147.html'),
 'road':source('road','1286','https://bigsoundbank.com/voiture-sur-route-s1286.html'),
 'skid':source('skid','2369','https://bigsoundbank.com/screeching-tires-2-s2369.html','Dorian CLAIR'),
 'ev':SRC/'ev-onboard.mp3',
}
credits['ev']={'page':'https://freesound.org/people/evsecrets/sounds/324119/','license':'CC0-1.0','author':'evsecrets','recording':'2011 Peugeot iOn, onboard start and driving'}
with zipfile.ZipFile(SRC/'performance-cars.zip') as z:
 for n in [1,7,9]:
    name=f'performance-{n:03}';path=SRC/(name+'.wav')
    if not path.exists():path.write_bytes(z.read(f'performance-cars-free-sample-pack-mutedio/{n:03}-performance-cars-mutedio.wav'))
    files[name]=path;credits[name]={'page':'https://muted.io/performance-cars/','license':'CC0-1.0','author':'muted.io','recording':f'Performance Cars field recordings, {n:03}'}
decoded={}
for name,path in files.items():
    result=subprocess.run([FFMPEG,'-v','error','-i',str(path),'-f','f32le','-ac','1','-ar',str(RATE),'pipe:1'],capture_output=True,check=True)
    decoded[name]=np.frombuffer(result.stdout,dtype='<f4').copy();print(name,round(len(decoded[name])/RATE,2),'s',flush=True)
def clip(name,key,start,duration,loop=True,road=False):
    raw=decoded[key];a=int(start*RATE);size=int(duration*RATE);x=raw[a:min(len(raw),a+size)].copy()
    if len(x)<RATE*.3:raise ValueError((name,len(x)))
    x-=x.mean()
    if road:
        # Road-only band, without the petrol engine's low-frequency firing note.
        temp=SRC/'road-filter-input.wav';sf.write(temp,x,RATE,subtype='PCM_16')
        p=subprocess.run([FFMPEG,'-v','error','-i',str(temp),'-af','highpass=f=420,lowpass=f=4500','-f','f32le','-ac','1','-ar',str(RATE),'pipe:1'],capture_output=True,check=True);x=np.frombuffer(p.stdout,dtype='<f4').copy()
    rms=float(np.sqrt(np.mean(x*x)));x*=min(.145/max(rms,.00001),.88/max(float(np.max(np.abs(x))),.00001))
    if loop:
        fade=min(int(.10*RATE),len(x)//6);blend=np.linspace(0,1,fade,dtype=np.float32);out=x[fade:].copy();out[-fade:]=x[-fade:]*(1-blend)+x[:fade]*blend;x=out
    else:
        fade=min(int(.01*RATE),len(x)//4);x[:fade]*=np.linspace(0,1,fade);x[-fade:]*=np.linspace(1,0,fade)
    sf.write(OUT/(name+'.wav'),x,RATE,subtype='PCM_16');return {'source':key,'start':start,'duration':len(x)/RATE,'loop':loop}
manifest={}
for name,key,start,duration in [
 ('small-idle','small',9,3.4),('small-load','rev',1.0,2.6),
 ('sedan-idle','small',22,3.8),('sedan-load','rev',3.5,2.1),
 ('v8-idle','cobra',7,3.6),('v8-load','performance-001',.35,2.6),
 ('sport-idle','cobra',13,3.2),('sport-load','performance-009',.5,3.3),
 ('race-idle','cobra',17,3.2),('race-load','performance-007',4,3.3),
 ('van-idle','van',12,3.6),('van-load','diesel-rev',6,3.0),
 ('truck-idle','iveco',9,3.6),('truck-load','diesel-rev',12,3.5),
 ('heavy-idle','heavy',2,4),('heavy-load','diesel-rev',15,3.2),
 ('ev-idle','ev',35,3.0),('ev-load','ev',46,4.0),
 ('road','road',28,4),('skid','skid',.3,1.7)]:manifest[name]=clip(name,key,start,duration,road=name=='road')
manifest['door']=clip('door','ev',.3,1.3,False)
manifest['ignition']=clip('ignition','small',1.5,1.1,False)
(OUT/'manifest.json').write_text(json.dumps({'sampleRate':RATE,'clips':manifest,'sources':credits,'processing':'Trimmed recorded audio, DC removal, conservative RMS/peak normalization, 100ms loop crossfades. No oscillator or synthesized engine layers.'},ensure_ascii=False,indent=2),encoding='utf-8')
print('Prepared',len(manifest),'recorded game clips',sum(p.stat().st_size for p in OUT.glob('*.wav')),'bytes',flush=True)
import runpy
runpy.run_path(str(Path(__file__).with_name('stabilize-car-recordings.py')),run_name='__main__')
