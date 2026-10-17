import {useEffect,useRef,useState} from 'react';
import type Hls from 'hls.js';
import type {TrafficCamera} from './trafficCctv';

export default function CctvPopup({camera,onClose,onRefresh}:{camera:TrafficCamera;onClose:()=>void;onRefresh:()=>void}){
  const video=useRef<HTMLVideoElement>(null),close=useRef<HTMLButtonElement>(null);
  const [state,setState]=useState('loading'),[attempt,setAttempt]=useState(0);
  useEffect(()=>{const before=document.activeElement as HTMLElement|null;close.current?.focus();return()=>{if(before?.isConnected)before.focus();};},[]);
  useEffect(()=>{
    const el=video.current;if(!el||!camera.media||camera.format==='image')return;
    let alive=true,hls:Hls|null=null;
    setState('loading');
    const timer=window.setTimeout(()=>{if(alive)setState('error');},18000);
    const ready=()=>{clearTimeout(timer);if(alive)setState('ready');};
    const fail=()=>{clearTimeout(timer);if(alive)setState('error');};
    el.addEventListener('playing',ready);el.addEventListener('error',fail);
    const play=()=>{void el.play().catch(()=>{if(alive)setState('play');});};
    if(camera.format!=='hls'||el.canPlayType('application/vnd.apple.mpegurl')){el.src=camera.media;play();}
    else void import('hls.js').then(({default:Hls})=>{
      if(!alive)return;
      if(!Hls.isSupported()){fail();return;}
      hls=new Hls({maxBufferLength:12,maxMaxBufferLength:24,backBufferLength:0});
      hls.on(Hls.Events.MANIFEST_PARSED,play);
      hls.on(Hls.Events.ERROR,(_,data)=>{if(data.fatal){hls?.destroy();hls=null;fail();}});
      hls.loadSource(camera.media!);hls.attachMedia(el);
    }).catch(fail);
    return()=>{alive=false;clearTimeout(timer);hls?.destroy();el.removeEventListener('playing',ready);el.removeEventListener('error',fail);el.pause();el.removeAttribute('src');el.load();};
  },[camera.id,camera.media,camera.format,attempt]);
  return <section className="re-cctv-popup" role="dialog" aria-modal="false" aria-label={`CCTV ${camera.name}`}
    onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onClose();}}}>
    <header><span>📹 CCTV</span><button ref={close} type="button" onClick={onClose} aria-label="CCTV 팝업 닫기">×</button></header>
    <h3>{camera.name}</h3>
    {camera.media?<div className="re-cctv-player">
      {camera.format==='image'?<img src={camera.media} alt={`${camera.name} CCTV 정지 영상`} onLoad={()=>setState('ready')} onError={()=>setState('error')}/>
        :<video ref={video} controls muted playsInline aria-label={`${camera.name} CCTV 영상`}/>}
      {state==='loading'&&<p role="status">제공기관 영상 연결 중…</p>}
      {state==='error'&&<p role="status">현재 영상을 재생할 수 없습니다.<button type="button" onClick={()=>{setAttempt(a=>a+1);onRefresh();}}>다시 연결</button></p>}
      {state==='play'&&<button type="button" onClick={()=>{void video.current?.play().catch(()=>setState('error'));}}>영상 재생</button>}
    </div>:<p className="re-cctv-unavailable">위치 정보가 공개된 CCTV입니다. 현재 연결된 공개 영상이 없습니다.</p>}
    {camera.address&&<p>{camera.address}</p>}
    <small>위도 {camera.lat.toFixed(5)} · 경도 {camera.lon.toFixed(5)}</small>
    {camera.updatedAt&&<small>제공기관 영상 시각: {camera.updatedAt}</small>}
    <footer>출처: {camera.source}<br/>영상은 제공기관 상황에 따라 지연되거나 중단될 수 있습니다.</footer>
  </section>;
}
