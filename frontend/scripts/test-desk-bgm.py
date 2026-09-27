"""Regression checks with a deterministic YouTube API double (no media playback).
Run with Vite at 127.0.0.1:5173 and Playwright/Edge installed.
"""
import atexit
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
root=Path(__file__).resolve().parents[2]
os.chdir(root)
paths=[root/'frontend/src/__bgm_test.tsx',root/'frontend/__bgm_test.html']
assert not any(p.exists() for p in paths),'Test harness already exists'
atexit.register(lambda:[p.unlink(missing_ok=True) for p in paths])
paths[0].write_text('''import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import DeskBgm from './desk2/DeskBgm';
import {attachDeskBgm,useDeskBgm} from './desk2/deskBgmStore';
import './desk2/desk2.css';
function Test(){const [mounted,setMounted]=useState(true);const state=useDeskBgm();(window as any).bgmState=state;(window as any).mountMeter=setMounted;useEffect(()=>attachDeskBgm(),[]);return <div className="d2">{mounted&&<DeskBgm/>}</div>}
createRoot(document.getElementById('root')!).render(<Test/>);
''',encoding='utf-8')
paths[1].write_text('<!doctype html><html class="is-desk2"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/src/__bgm_test.tsx"></script></body></html>',encoding='utf-8')
fake='''window.YT={Player:class {
 constructor(host,options){this.events=options.events;this.state=2;this.block=false;this.origin=performance.now();window.testPlayer=this;setTimeout(()=>this.events.onReady({target:this}),0)}
 emit(s){this.state=s;this.events.onStateChange({target:this,data:s})}
 playVideo(){if(!this.block&&this.state!==1)this.emit(1)}
 pauseVideo(){this.emit(2)}
 loadVideoById(id){this.id=id;this.origin=performance.now();this.playVideo()}
 getPlayerState(){return this.state}
 getCurrentTime(){if(this.failTime){this.failTime=false;throw Error('temporary clock failure')}return (performance.now()-this.origin)/1000}
 setVolume(){} destroy(){}
}};'''
with sync_playwright() as p:
 browser=p.chromium.launch(channel='msedge',headless=True)
 page=browser.new_page()
 page.add_init_script(fake)
 page.route('https://www.youtube.com/**',lambda r:r.fulfill(body=''))
 errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:5173/__bgm_test.html')
 page.get_by_role('button',name='재생',exact=True).click()
 page.wait_for_function('window.bgmState.playing && !window.bgmState.loading')
 def moving():
  a=page.locator('.d2-bgm-eq').evaluate('(e)=>[...e.children].map(b=>b.style.getPropertyValue("--lvl"))')
  page.wait_for_timeout(220)
  b=page.locator('.d2-bgm-eq').evaluate('(e)=>[...e.children].map(b=>b.style.getPropertyValue("--lvl"))')
  assert a!=b,(a,b)
 moving()
 # Already playing on visibility return sends NO new PLAYING event.
 page.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))")
 page.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'))")
 page.wait_for_timeout(4300)
 assert page.evaluate('bgmState.playing && !bgmState.blocked && !bgmState.loading')
 moving()
 print('PASS no false timeout after visibility return',flush=True)
 # Slow route mounts must not turn the singleton off.
 page.evaluate('mountMeter(false)')
 page.wait_for_timeout(1800)
 assert page.evaluate('bgmState.on && bgmState.playing')
 page.evaluate('mountMeter(true)')
 page.locator('.d2-bgm-eq').wait_for()
 moving()
 print('PASS route remount retains playback and meter',flush=True)
 page.evaluate('testPlayer.failTime=true')
 moving()
 page.get_by_role('button',name='일시정지',exact=True).click()
 page.evaluate('testPlayer.block=true')
 page.get_by_role('button',name='재생',exact=True).click()
 page.wait_for_timeout(4300)
 assert page.evaluate('bgmState.blocked && !bgmState.playing')
 page.evaluate('testPlayer.block=false;testPlayer.emit(1)')
 page.wait_for_function('bgmState.playing && !bgmState.blocked')
 moving()
 print('PASS late PLAYING recovers watchdog timeout',flush=True)
 page.evaluate('testPlayer.emit(3)')
 page.wait_for_function('bgmState.loading')
 page.evaluate('testPlayer.emit(1)')
 page.wait_for_function('!bgmState.loading')
 moving()
 old=page.evaluate('bgmState.track.id')
 page.get_by_role('button',name='다음 곡',exact=True).click()
 page.wait_for_function('!bgmState.loading')
 assert page.evaluate('bgmState.track.id')!=old
 moving()
 # Missing events are repaired by querying the actual player state.
 page.evaluate('testPlayer.emit(3);testPlayer.state=1')
 page.wait_for_function('!bgmState.loading',timeout=2500)
 moving()
 page.get_by_role('button',name='일시정지',exact=True).click()
 page.evaluate('testPlayer.emit(1)')
 assert page.evaluate('!bgmState.playing && testPlayer.state===2')
 assert not errors,errors
 print('PASS clock exception, buffering, track change, missed event, deliberate pause',flush=True)
 browser.close()
