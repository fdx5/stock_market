"""Make stationary-RPM textures from real recordings, without repeating rev-ups.
Preserves the source clips; writes separate *-load-steady.wav game assets.
"""
import json
from pathlib import Path
import numpy as np
import soundfile as sf

OUT=Path(__file__).resolve().parents[1]/'public/3d/walk/cars/audio'
manifest=json.loads((OUT/'manifest.json').read_text(encoding='utf-8'));report={}
def moving_rms(x,width):
    pad=np.pad(x*x,(width//2,width-width//2),mode='wrap');s=np.cumsum(np.r_[0,pad],dtype=np.float64)
    return np.sqrt(np.maximum(1e-10,(s[width:]-s[:-width])[:len(x)]/width))
for bank in ['small','sedan','v8','sport','race','van','truck','heavy','ev']:
    original=bank+'-load';x,rate=sf.read(OUT/(original+'.wav'),dtype='float32');length=int(.48*rate);hop=int(.02*rate);best=None
    full_rms=float(np.sqrt(np.mean(x*x)))
    for start in range(0,max(1,len(x)-length),hop):
        window=x[start:start+length]
        if len(window)<length or np.sqrt(np.mean(window*window))<full_rms*.4:continue
        blocks=window.reshape(8,-1);rms=np.sqrt(np.mean(blocks*blocks,axis=1)+1e-9)
        spectra=np.abs(np.fft.rfft(blocks,axis=1));freq=np.fft.rfftfreq(blocks.shape[1],1/rate);centroid=(spectra*freq).sum(1)/(spectra.sum(1)+1e-9)
        cost=float(np.std(np.log(rms))+.6*np.std(centroid)/(np.mean(centroid)+1))
        if best is None or cost<best[0]:best=(cost,start,window.copy())
    cost,start,window=best;fade=int(.08*rate);blend=np.linspace(0,1,fade,dtype=np.float32)
    steady=window[fade:].copy();steady[-fade:]=window[-fade:]*(1-blend)+window[:fade]*blend
    # Remove the recording's acceleration loudness envelope; retain its actual
    # engine waveform. Cyclic smoothing also treats the loop boundary equally.
    envelope=moving_rms(steady,int(.035*rate));gain=np.clip(np.median(envelope)/envelope,.45,2.2)
    gain=moving_rms(gain,int(.025*rate));steady*=gain.astype(np.float32)
    steady-=steady.mean();steady*=min(.115/max(float(np.sqrt(np.mean(steady*steady))),1e-6),.62/max(float(np.max(np.abs(steady))),1e-6))
    name=original+'-steady';sf.write(OUT/(name+'.wav'),steady,rate,subtype='PCM_16')
    short=moving_rms(steady,int(.035*rate));cv=float(np.std(short)/np.mean(short));old=moving_rms(x,int(.035*rate))
    report[bank]={'sourceEnvelopeCv':float(np.std(old)/np.mean(old)),'steadyEnvelopeCv':cv,'peak':float(np.max(np.abs(steady))),'loopJump':float(abs(steady[0]-steady[-1])),'duration':len(steady)/rate}
    manifest['clips'][name]={**manifest['clips'][original],'derivedFrom':original,'stableSourceOffset':start/rate,'duration':len(steady)/rate,'loop':True,'processing':'Stationary 480ms grain, 80ms seam blend, cyclic envelope stabilization; no recorded rev-up loop.'}
manifest['processing']+=' Loaded engine playback uses separately stabilized stationary-RPM recording grains; dynamic RPM supplies the pitch curve.'
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
report_path=Path(__file__).resolve().parents[2]/'tmp/walk-car-recordings/stationary-loops.json';report_path.parent.mkdir(parents=True,exist_ok=True);report_path.write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report),flush=True)
