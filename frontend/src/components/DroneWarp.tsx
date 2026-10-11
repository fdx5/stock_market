import {useEffect,useRef} from 'react';
import DroneWarpScene from './DroneWarpScene';
import './drone-warp-cinematic.css';

/** A cinematic procedural transition over the destination's live renderer. */
export default function DroneWarp({name,elapsed,error,reveal=false,onCancel,onRetry}: {
  name:string;elapsed:boolean;error:string;reveal?:boolean;onCancel:()=>void;onRetry:()=>void;
}) {
  const box=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=box.current;dialog?.showModal();return()=>{if(dialog?.open)dialog.close();};},[]);
  return <dialog ref={box} className={`drone-warp drone-warp--cinematic${elapsed?' is-arriving':''}${reveal?' is-revealing':''}`} aria-label="드론뷰 워프 이동"
    data-phase={elapsed?'arriving':'warp'} onKeyDown={e=>e.stopPropagation()} onCancel={e=>{e.preventDefault();onCancel();}}>
    <div className="drone-warp-space" aria-hidden="true">
      <div className="drone-warp-nebula"/><div className="drone-warp-nebula is-violet"/>
      <DroneWarpScene waiting={elapsed}/>
      <div className="drone-warp-lens"/><div className="drone-warp-horizon"/>
      <div className="drone-warp-vignette"/>
    </div>
    <div className="drone-warp-hud" aria-hidden="true"><span>DRONE EXPLORER</span><b>WARP TRANSIT</b><i/><i/></div>
    {reveal&&<div className="drone-warp-arrival-flash" aria-hidden="true"/>}
    <div className="drone-warp-caption">
      <small>{reveal?'DESTINATION REACHED':'NEXT DESTINATION'}</small>
      <h2>{name}</h2>
      <p role="status" aria-live="polite">{reveal?'목적지에 도착했습니다':elapsed?(error?'도착 지역을 불러오지 못했어요. 다시 시도해 주세요.':'도착 지역을 준비하고 있어요…'):'별빛을 넘어 새로운 풍경으로'}</p>
      <div className="drone-warp-progress" aria-hidden="true"><i/></div>
      <div className="drone-warp-actions">
        {elapsed&&error&&<button type="button" onClick={onRetry}>다시 시도</button>}
        <button type="button" onClick={onCancel}>이동 취소</button>
      </div>
    </div>
  </dialog>;
}
