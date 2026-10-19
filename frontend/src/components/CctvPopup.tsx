import {useEffect,useRef,useState} from 'react';
import type Hls from 'hls.js';
import type {TrafficCamera} from './trafficCctv';

// direct: the provider's own HTTPS stream (public); media: the same through this server.
type Source={media:string;format:NonNullable<TrafficCamera['format']>;direct?:string};

export default function CctvPopup({camera,onClose,onRefresh}:{camera:TrafficCamera;onClose:()=>void;onRefresh:()=>void}){
  const video=useRef<HTMLVideoElement>(null),close=useRef<HTMLButtonElement>(null);
  const [state,setState]=useState('loading'),[attempt,setAttempt]=useState(0);
  const [source,setSource]=useState<Source|null>(camera.media?{media:camera.media,format:camera.format??'hls'}:null);
  // City streams stop after the provider's 60 seconds: they reconnect by themselves, a bounded number of times.
  const rejoins=useRef(0);
  useEffect(()=>{const before=document.activeElement as HTMLElement|null;close.current?.focus();return()=>{if(before?.isConnected)before.focus();};},[]);
  useEffect(()=>{
    if(camera.media||!camera.resolve)return;
    const stop=new AbortController();
    setState('loading');setSource(null);
    fetch(camera.resolve,{signal:stop.signal}).then(async r=>{if(!r.ok)throw new Error(String(r.status));return r.json();})
      .then((s:Source)=>{if(!stop.signal.aborted&&typeof s?.media==='string')setSource({media:s.media,format:s.format??'hls',direct:typeof s.direct==='string'&&s.direct.startsWith('https://')?s.direct:undefined});else setState('error');})
      .catch(()=>{if(!stop.signal.aborted)setState('error');});
    return()=>stop.abort();
  },[camera.resolve,camera.media,attempt]);
  useEffect(()=>{
    const el=video.current;if(!el||!source||source.format==='image')return;
    let alive=true,hls:Hls|null=null;
    setState('loading');
    const url=source.direct??source.media;
    // A direct stream that will not start falls back to the relay before reporting an error.
    const fail=()=>{clearTimeout(timer);if(!alive)return;if(source.direct)setSource({...source,direct:undefined});else setState('error');};
    const timer=window.setTimeout(fail,source.direct?9000:18000);
    const ready=()=>{clearTimeout(timer);if(alive)setState('ready');};
    const ended=()=>{if(alive&&camera.resolve&&rejoins.current++<20)setAttempt(a=>a+1);};
    el.addEventListener('playing',ready);el.addEventListener('error',fail);el.addEventListener('ended',ended);
    const play=()=>{void el.play().catch(()=>{if(alive)setState('play');});};
    // hls.js wherever it runs: Chrome's own HLS player gave up on the first relayed
    // city segment. Native playback is the fallback (iPhone Safari has no MSE).
    const native=()=>{if(el.canPlayType('application/vnd.apple.mpegurl')){el.src=url;play();}else fail();};
    if(source.format!=='hls'){el.src=url;play();}
    else void import('hls.js').then(({default:Hls})=>{
      if(!alive)return;
      if(!Hls.isSupported()){native();return;}
      hls=new Hls({maxBufferLength:12,maxMaxBufferLength:24,backBufferLength:0});
      hls.on(Hls.Events.MANIFEST_PARSED,play);
      hls.on(Hls.Events.ERROR,(_,data)=>{if(data.fatal){hls?.destroy();hls=null;if(el.currentTime>0)ended();else fail();}});
      hls.loadSource(url);hls.attachMedia(el);
    }).catch(fail);
    return()=>{alive=false;clearTimeout(timer);hls?.destroy();el.removeEventListener('playing',ready);el.removeEventListener('error',fail);el.removeEventListener('ended',ended);el.pause();el.removeAttribute('src');el.load();};
  },[source,camera.resolve,attempt]);
  const available=!!(camera.media||camera.resolve);
  return <section className="re-cctv-popup" role="dialog" aria-modal="false" aria-label={`CCTV ${camera.name}`}
    onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onClose();}}}>
    <header><span>📹 CCTV</span><button ref={close} type="button" onClick={onClose} aria-label="CCTV 팝업 닫기">×</button></header>
    <h3>{camera.name}</h3>
    {available?<div className="re-cctv-player">
      {source?.format==='image'?<img src={source.media} alt={`${camera.name} CCTV 정지 영상`} onLoad={()=>setState('ready')} onError={()=>setState('error')}/>
        :<video ref={video} controls autoPlay muted playsInline aria-label={`${camera.name} CCTV 영상`}/>}
      {state==='loading'&&<p role="status">제공기관 영상 연결 중…</p>}
      {state==='error'&&<p role="status">현재 영상을 재생할 수 없습니다.<button type="button" onClick={()=>{rejoins.current=0;setAttempt(a=>a+1);if(camera.media)onRefresh();}}>다시 연결</button></p>}
      {state==='play'&&<button type="button" onClick={()=>{void video.current?.play().catch(()=>setState('error'));}}>영상 재생</button>}
    </div>:<p className="re-cctv-unavailable">위치 정보가 공개된 CCTV입니다. 현재 연결된 공개 영상이 없습니다.</p>}
    {camera.address&&<p>{camera.address}</p>}
    <small>위도 {camera.lat.toFixed(5)} · 경도 {camera.lon.toFixed(5)}</small>
    {camera.updatedAt&&<small>제공기관 영상 시각: {camera.updatedAt}</small>}
    <footer>출처: {camera.source}<br/>영상은 제공기관 상황에 따라 지연되거나 중단될 수 있습니다.</footer>
  </section>;
}
