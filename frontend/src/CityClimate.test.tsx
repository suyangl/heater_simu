// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {CityClimate} from './CityClimate';
import {LanguageProvider} from './Language';
import {defaultClimate} from './billing';

let host:HTMLDivElement,root:Root;
const lyon={id:1,name:'Lyon',country_code:'FR',latitude:45.75,longitude:4.85};
const city=(id:number,name:string)=>({...lyon,id,name});
const json=(data:unknown)=>({ok:true,json:async()=>data});
const box=()=>host.querySelector<HTMLInputElement>('[role=combobox]')!;
function type(value:string){act(()=>{
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(box(),value);
  box().dispatchEvent(new Event('input',{bubbles:true}));
});}
const key=(key:string)=>act(()=>box().dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true})));
const tick=async(ms=300)=>{await act(async()=>{await vi.advanceTimersByTimeAsync(ms);});};
const mount=(apply=vi.fn())=>{act(()=>root.render(<LanguageProvider><CityClimate climate={defaultClimate()} onApply={apply}/></LanguageProvider>));return apply;};
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-10T00:00:00Z'));localStorage.clear();
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();});
describe('city climate combobox',()=>{
  it('fetches only after two typed characters and 300 ms, debounces edits, and cancels on Escape',async()=>{
    const fetcher=vi.fn().mockResolvedValue(json({results:[lyon]}));vi.stubGlobal('fetch',fetcher);mount();
    await tick(500);expect(fetcher).not.toHaveBeenCalled();
    type('L');await tick(500);expect(fetcher).not.toHaveBeenCalled();
    type('Ly');await tick(200);type('Lyon');await tick(299);expect(fetcher).not.toHaveBeenCalled();
    await tick(1);expect(fetcher).toHaveBeenCalledTimes(1);expect(box().getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[role=option]')!.textContent).toContain('Lyon');
    type('Paris');key('Escape');await tick(500);expect(fetcher).toHaveBeenCalledTimes(1);
    expect(box().getAttribute('aria-expanded')).toBe('false');
  });
  it('supports arrow navigation and Enter selection and applies the fetched monthly means immediately',async()=>{
    const time:string[]=[],temperature_2m_mean:number[]=[];
    for(let d=Date.UTC(2016,0,1);d<Date.UTC(2026,0,1);d+=86400000){time.push(new Date(d).toISOString().slice(0,10));temperature_2m_mean.push(7);}
    const fetcher=vi.fn().mockResolvedValueOnce(json({results:[lyon,city(2,'Paris')]})).mockResolvedValueOnce(json({daily:{time,temperature_2m_mean}}));
    vi.stubGlobal('fetch',fetcher);const apply=mount();type('Lyon');await tick();
    expect(apply).not.toHaveBeenCalled();key('ArrowDown');
    expect(host.querySelector('[aria-selected=true]')!.textContent).toContain('Paris');
    key('ArrowUp');expect(box().getAttribute('aria-activedescendant')).toBe(host.querySelector('[aria-selected=true]')!.id);
    await act(async()=>{box().dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));});
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({means:{10:7,11:7,12:7,1:7,2:7,3:7,4:7}}),lyon);
    expect(fetcher).toHaveBeenCalledTimes(2);expect(box().getAttribute('aria-expanded')).toBe('false');
    expect(box().value).toBe('Lyon, FR');
  });
  it('applies a clicked candidate and retains current climate on archive errors',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(json({results:[lyon]})).mockRejectedValueOnce(Error('offline'));
    vi.stubGlobal('fetch',fetcher);const apply=mount();type('Lyon');await tick();
    await act(async()=>{host.querySelector<HTMLElement>('[role=option]')!.click();});
    expect(apply).not.toHaveBeenCalled();expect(host.querySelector('[role=alert]')!.textContent).toContain('have been kept');
  });
  it('ignores stale searches and handles no results without applying anything',async()=>{
    let resolve!:(data:unknown)=>void;
    const fetcher=vi.fn().mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValueOnce(json({results:[]}));
    vi.stubGlobal('fetch',fetcher);const apply=mount();type('Paris');await tick();type('Lyon');await tick();
    await act(async()=>{resolve(json({results:[city(2,'Paris')]}));});
    expect(host.querySelector('[role=option]')).toBeNull();expect(host.textContent).toContain('No cities found');
    expect(apply).not.toHaveBeenCalled();
  });
});
