import struct,json,sys
from pathlib import Path
p=Path(sys.argv[1]);f=p.open('rb')
expected=json.loads(Path(sys.argv[2]).read_text(encoding='utf-8')) if len(sys.argv)>2 else {'width':3840,'height':2160,'frames':9720,'seconds':162,'fps':60}
def boxes(start,end):
 at=start
 while at+8<=end:
  f.seek(at);n,kind=struct.unpack('>I4s',f.read(8));head=8
  if n==1:n=struct.unpack('>Q',f.read(8))[0];head=16
  if n==0:n=end-at
  if n<head:raise ValueError('Malformed MP4 box')
  yield kind.decode('latin1'),at+head,at+n
  at+=n
def children(start,end,kind):return [(s,e) for k,s,e in boxes(start,end) if k==kind]
moov=children(0,p.stat().st_size,'moov')[0]
tracks=[]
for ts,te in children(*moov,'trak'):
 mdia=children(ts,te,'mdia')[0];mdhd=children(*mdia,'mdhd')[0];f.seek(mdhd[0]);b=f.read(mdhd[1]-mdhd[0]);version=b[0]
 if version==0:scale,duration=struct.unpack_from('>II',b,12)
 else:scale,duration=struct.unpack_from('>IQ',b,20)
 hdlr=children(*mdia,'hdlr')[0];f.seek(hdlr[0]+8);handler=f.read(4).decode()
 minf=children(*mdia,'minf')[0];stbl=children(*minf,'stbl')[0];stsz=children(*stbl,'stsz')[0];f.seek(stsz[0]+8);samples=struct.unpack('>I',f.read(4))[0]
 stts=children(*stbl,'stts')[0];f.seek(stts[0]+4);entries=struct.unpack('>I',f.read(4))[0];timings=[struct.unpack('>II',f.read(8)) for _ in range(entries)]
 track={'handler':handler,'samples':samples,'timeScale':scale,'duration':duration/scale,'timings':timings}
 if handler=='vide':
  tkhd=children(ts,te,'tkhd')[0];f.seek(tkhd[1]-8);w,h=struct.unpack('>II',f.read(8));track.update(width=w/65536,height=h/65536,fps=samples/(duration/scale))
  assert w/65536==expected['width'] and h/65536==expected['height'] and samples==expected['frames'] and abs(duration/scale-expected['seconds'])<.001 and abs(track['fps']-expected['fps'])<.001
 tracks.append(track)
assert any(t['handler']=='soun' for t in tracks)
result={'file':str(p),'bytes':p.stat().st_size,'tracks':tracks}
print(json.dumps(result,indent=2));p.with_suffix('.verification.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
