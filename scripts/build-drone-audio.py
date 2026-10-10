"""Build small DJI loops from preserved CC0 public previews. No app DB/env."""
from pathlib import Path
import hashlib, json, subprocess, wave
import imageio_ffmpeg
import numpy as np

root=Path(__file__).resolve().parents[1]
source=root/'tmp/drone-audio-review-20261010'
out=root/'frontend/public/3d/drone/mini2-20261010-v2'
out.mkdir()  # A new version; never overwrite a previous source/asset directory.
rate=24000

def filtered(name,start,duration):
    data=subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-hide_banner','-loglevel','error',
        '-ss',str(start),'-t',str(duration),'-i',str(source/(name+'-decoded.wav')),
        '-af','highpass=f=120,lowpass=f=5800','-ac','1','-ar',str(rate),'-f','f32le','pipe:1'],capture_output=True,check=True).stdout
    return np.frombuffer(data,dtype='<f4').astype(float)

hover=filtered('mini2-hover',2,6.5)
cross=int(.5*rate)
angle=np.linspace(0,np.pi/2,cross,endpoint=True)
hover=np.concatenate([hover[cross:-cross],hover[-cross:]*np.cos(angle)+hover[:cross]*np.sin(angle)])
hover-=hover.mean()
hover*=.105/np.sqrt(np.mean(hover**2))

start=filtered('mini2-start',.5,2.4)  # Skip the initial handling/impact transient.
start-=start.mean()
start*=.105/np.sqrt(np.mean(start**2))
start[:int(.09*rate)]*=np.linspace(0,1,int(.09*rate))
start[-int(.8*rate):]*=np.linspace(1,0,int(.8*rate))

stats={'processing':{'sampleRate':rate,'hoverSourceStart':2,'hoverSourceDuration':6.5,'crossfade':.5,'startSourceStart':.5,'startSourceDuration':2.4,'filtersHz':[120,5800]}}
for name,data in [('hover',hover),('start',start)]:
    peak=float(abs(data).max())
    if peak>.85: data*=.85/peak
    p=out/(name+'.wav')
    with wave.open(str(p),'wb') as f:
        f.setnchannels(1);f.setsampwidth(2);f.setframerate(rate)
        f.writeframes(np.round(data*32767).astype('<i2').tobytes())
    stats[name]={'seconds':len(data)/rate,'rms':float(np.sqrt(np.mean(data**2))),
        'peak':float(abs(data).max()),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
stats['sources']={name:hashlib.sha256((source/(name+'.mp3')).read_bytes()).hexdigest() for name in ['mini2-hover','mini2-start']}
(out/'build-info.json').write_text(json.dumps(stats,indent=2),encoding='utf8')
print(json.dumps(stats))
