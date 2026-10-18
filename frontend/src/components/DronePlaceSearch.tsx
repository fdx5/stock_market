import {useEffect,useId,useRef,useState} from 'react';
import {searchDronePlaces} from './dronePlaceClient';
import {placeDisplayTitle,type DronePlace} from './dronePlaces';
import './drone-place-search.css';

export default function DronePlaceSearch({mapKey,domain='https://kospimap.com',initialPlace,onMove,onTyping}: {
  mapKey?:string|null; domain?:string; initialPlace?:DronePlace; onMove:(place:DronePlace)=>void; onTyping:()=>void;
}) {
  const id=useId(), input=useRef<HTMLInputElement>(null), box=useRef<HTMLDivElement>(null);
  const [text,setText]=useState(initialPlace?placeDisplayTitle(initialPlace):''),[selected,setSelected]=useState<DronePlace|null>(initialPlace??null);
  const [items,setItems]=useState<DronePlace[]>([]),[open,setOpen]=useState(false),[loading,setLoading]=useState(false);
  const [message,setMessage]=useState(''),[active,setActive]=useState(-1),[composing,setComposing]=useState(false),[retry,setRetry]=useState(0);
  const choose=(p:DronePlace)=>{
    // Finish the input's IME before committing the destination: its final
    // composition/change events must not clear the place just selected.
    input.current?.blur();
    setComposing(false);setSelected(p);setText(placeDisplayTitle(p));setOpen(false);setActive(-1);
    input.current?.focus({preventScroll:true});
  };
  useEffect(()=>{
    const q=text.trim(); setItems([]);setActive(-1);setMessage('');
    // Korean IMEs keep the final complete syllable in composition until Space.
    // Search the idle displayed value; only incomplete trailing jamo wait.
    if(selected||q.length<2||/[\u1100-\u11ff\u3130-\u318f]$/.test(q)||!mapKey){setLoading(false);return;}
    const ctl=new AbortController();setLoading(true);
    const timer=window.setTimeout(()=>{
      void searchDronePlaces(q,mapKey,domain,ctl.signal,result=>{setItems(result);setActive(-1);})
        .then(({failed,sources})=>{if(!ctl.signal.aborted)setMessage(failed===sources&&failed?'검색 정보를 가져오지 못했습니다. 다시 검색해 주세요.':failed?'일부 검색 응답이 지연됐습니다. 다시 검색할 수 있습니다.':'');})
        .catch(()=>{if(!ctl.signal.aborted)setMessage('검색에 연결하지 못했습니다. 다시 검색해 주세요.');})
        .finally(()=>{if(!ctl.signal.aborted)setLoading(false);});
    },300);
    return()=>{clearTimeout(timer);ctl.abort();};
  },[text,selected,mapKey,domain,retry]);
  useEffect(()=>{
    const outside=(e:PointerEvent)=>{if(!box.current?.contains(e.target as Node))setOpen(false);};
    document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
  },[]);
  useEffect(()=>{if(active>=0)document.getElementById(`${id}-${active}`)?.scrollIntoView({block:'nearest'});},[active,id]);
  const show=open&&!selected;
  return <div className="re-drone-place-search" ref={box} onKeyDown={e=>{
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setOpen(false);return;}
    if(e.nativeEvent.isComposing||composing)return;
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setOpen(true);setActive(v=>items.length?(v+(e.key==='ArrowDown'?1:-1)+items.length)%items.length:-1);}
    if(e.key==='Enter'&&e.target===input.current){e.preventDefault();if(show&&active>=0&&items[active])choose(items[active]);else setOpen(true);}
  }}>
    <div className="re-drone-place-search-row">
      <input ref={input} type="search" role="combobox" aria-label="드론뷰 장소 및 주소 검색" autoComplete="off"
        placeholder="아파트·지역·학교·주소 검색" value={text} aria-expanded={show} aria-controls={id} aria-autocomplete="list"
        aria-activedescendant={show&&active>=0?`${id}-${active}`:undefined} disabled={!mapKey}
        onCompositionStart={()=>setComposing(true)} onCompositionEnd={e=>{setComposing(false);setText(e.currentTarget.value);setSelected(null);setOpen(true);}}
        onFocus={()=>{onTyping();if(!selected)setOpen(true);}}
        onClick={()=>{if(!selected)setOpen(true);}}
        onChange={e=>{setText(e.currentTarget.value);setSelected(null);setOpen(true);}} />
      <button type="button" className="re-drone-place-go" disabled={!selected} onClick={()=>{if(selected){setOpen(false);onMove(selected);}}}>이동</button>
    </div>
    {show&&<div className="re-drone-place-popup">
      <div id={id} role="listbox" aria-label="장소 및 주소 검색 결과" className="re-drone-place-results">
        {items.map((p,i)=><button type="button" role="option" id={`${id}-${i}`} key={p.id} aria-selected={active===i}
          // Keep focus until click: dismissing the keyboard on mousedown can
          // move the list before click and consume the first selection.
          onMouseDown={e=>e.preventDefault()}
          onClick={()=>choose(p)} className={active===i?'is-active':undefined}>
          <span className="re-drone-place-kind">{p.kind}</span><span className="re-drone-place-label"><b>{placeDisplayTitle(p)}</b><small>{p.address||'지역 중심으로 이동'}</small></span>
        </button>)}
      </div>
      <p role="status" aria-live="polite">{text.trim().length<2?'두 글자 이상 입력하세요.':loading?'검색 중…':message||(!items.length?'검색 결과가 없습니다. 이름 또는 주소를 확인해 주세요.':'결과를 선택한 후 이동을 누르세요.')}</p>
      {message&&!loading&&<button type="button" className="re-drone-place-retry" onClick={()=>setRetry(v=>v+1)}>다시 검색</button>}
    </div>}
  </div>;
}
