import {useEffect,useRef,type CSSProperties} from 'react';

/** A light CSS transition over the destination's live renderer. It owns no
 * canvas/textures and never pauses the scene being downloaded underneath. */
export default function DroneWarp({name,elapsed,error,onCancel,onRetry}: {
  name:string;elapsed:boolean;error:string;onCancel:()=>void;onRetry:()=>void;
}) {
  const box=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=box.current;dialog?.showModal();return()=>{if(dialog?.open)dialog.close();};},[]);
  return <dialog ref={box} className={`drone-warp${elapsed?' is-arriving':''}`} aria-label="드론뷰 워프 이동"
    data-phase={elapsed?'arriving':'warp'} onKeyDown={e=>e.stopPropagation()} onCancel={e=>{e.preventDefault();onCancel();}}>
    <div className="drone-warp-space" aria-hidden="true">
      <div className="drone-warp-glow" />
      {Array.from({length:48},(_,i)=><i key={i} className="drone-warp-ray" style={{'--warp-angle':`${i*137.508}deg`,'--warp-delay':`${-(i%13)*.11}s`,'--warp-distance':`${20+i%7*5}px`} as CSSProperties}/>)}
      {Array.from({length:5},(_,i)=><i key={i} className="drone-warp-ring" style={{'--warp-delay':`${-i*.28}s`} as CSSProperties}/>)}
      <span className="drone-warp-cross">✦</span>
    </div>
    <div className="drone-warp-caption">
      <small>DRONE EXPLORER · WARP</small>
      <h2>{name}</h2>
      <p role="status" aria-live="polite">{elapsed?(error?'도착 지역을 불러오지 못했어요. 다시 시도해 주세요.':'도착 지역을 준비하고 있어요…'):'새로운 풍경으로 이동합니다'}</p>
      <div className="drone-warp-progress" aria-hidden="true"><i/></div>
      <div className="drone-warp-actions">
        {elapsed&&error&&<button type="button" onClick={onRetry}>다시 시도</button>}
        <button type="button" onClick={onCancel}>이동 취소</button>
      </div>
    </div>
  </dialog>;
}
