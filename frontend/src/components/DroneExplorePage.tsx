import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBroadsheet } from '../desk2/shell';
import { useL } from '../desk2/lib';
import { useLanguage } from '../i18n/LanguageContext';
import { useDocumentTitle } from '../useDocumentTitle';
import LoadingState from './LoadingState';
import { navigate } from '../router';
import {dronePlaceId,readDronePlace,placeDisplayTitle,type DronePlace} from './dronePlaces';
import DroneWarp from './DroneWarp';
import {droneDestinationUrl,incomingDroneTravel,consumeDroneTravel} from './droneTravel';
import './drone-explore.css';

const ComplexHologram = lazy(() => import('./ComplexHologram'));
const START_COMPLEX = '11290:길음동:1288:래미안길음센터피스';

export default function DroneExplorePage() {
  useBroadsheet();
  const L = useL(), { lang } = useLanguage();
  useDocumentTitle(L('드론 탐험 | K-Stock Hub', 'Drone explorer | K-Stock Hub'));
  const [route,setRoute]=useState(()=>({query:new URLSearchParams(location.search),visit:0}));
  const incoming=useRef(incomingDroneTravel(location.pathname+location.search));
  const [warp,setWarp]=useState<{id:number;name:string;started:number;elapsed:boolean;ready:boolean;error:string;from:string}|null>(()=>incoming.current?{...incoming.current,id:1,elapsed:false,ready:false,error:''}:null);
  const warpSeq=useRef(incoming.current?1:0),warpUrl=useRef(incoming.current?.url??'');
  useEffect(()=>consumeDroneTravel(incoming.current),[]);
  useEffect(()=>{
    const update=()=>{
      if(warpUrl.current&&location.pathname+location.search!==warpUrl.current){warpUrl.current='';setWarp(null);}
      setRoute(v=>({query:new URLSearchParams(location.search),visit:v.visit+1}));
    };
    window.addEventListener('popstate',update);return()=>window.removeEventListener('popstate',update);
  },[]);
  const complexId = route.query.get('complex') || START_COMPLEX;
  const place=useMemo(()=>readDronePlace(route.query),[route.query]);
  const move=useCallback((target:DronePlace)=>{
    warpUrl.current=droneDestinationUrl(target,complexId,new URLSearchParams(location.search));
    setWarp({id:++warpSeq.current,name:placeDisplayTitle(target),started:performance.now(),elapsed:false,ready:false,error:'',from:location.pathname+location.search});
    navigate(warpUrl.current);
  },[complexId]);
  const warpId=warp?.id;
  const ready=useCallback(()=>setWarp(v=>v&&v.id===warpId?{...v,ready:true}:v),[warpId]);
  const failed=useCallback(()=>setWarp(v=>v&&v.id===warpId?{...v,error:'load'}:v),[warpId]);
  useEffect(()=>{
    if(!warp)return;
    const id=warp.id,timer=window.setTimeout(()=>setWarp(v=>v?.id===id?{...v,elapsed:true}:v),Math.max(0,5000-(performance.now()-warp.started)));
    const deadline=window.setTimeout(()=>setWarp(v=>v?.id===id&&!v.ready?{...v,error:'timeout'}:v),120000);
    return()=>{window.clearTimeout(timer);window.clearTimeout(deadline);};
  },[warpId]);
  useEffect(()=>{if(warp?.elapsed&&warp.ready){warpUrl.current='';setWarp(null);}},[warp?.elapsed,warp?.ready]);
  const cancelWarp=()=>{if(!warp)return;const from=warp.from;warpUrl.current='';setWarp(null);navigate(from);};
  const retryWarp=()=>{if(!warp)return;setWarp({...warp,id:++warpSeq.current,started:performance.now(),elapsed:false,ready:false,error:''});navigate(warpUrl.current);};
  const close = useCallback(() => navigate('/realestate-map'), []);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    // The flight handles Escape first (a selected building card closes before the flight).
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    document.addEventListener('keydown', escape);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', escape); };
  }, [close]);
  return createPortal(
    <main data-covers-page className="d2 drone-explore-page" lang={lang} aria-label={L('드론 탐험 전체화면', 'Full-screen drone explorer')}>
      <Suspense fallback={<LoadingState text="드론 탐험을 준비하는 중…" />}>
        <ComplexHologram key={`${place?dronePlaceId(place):complexId}:${route.visit}`} complexId={complexId} explorePlace={place}
          onExploreMove={move} onExploreReady={ready} onExploreError={failed} wide autoDrone onDroneExit={close} caption={L('도시 탐험 · 드론 비행', 'City explorer · drone flight')} />
      </Suspense>
      {warp&&<DroneWarp key={warp.id} name={warp.name} elapsed={warp.elapsed} error={warp.error} onCancel={cancelWarp} onRetry={retryWarp}/>}
      <button ref={closeButton} type="button" className="drone-explore-close" onClick={close}
        aria-label={L('드론 탐험 닫기', 'Close drone explorer')} title={L('닫고 부동산 지도로 이동 (Esc)', 'Close and return to the property map (Esc)')}>×</button>
    </main>, document.body,
  );
}
