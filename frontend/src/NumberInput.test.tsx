// @vitest-environment jsdom
import React,{act,useState} from 'react';
import {createRoot,Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {NumberInput} from './NumberInput';
import {formatNumber} from './numberFormat';

let host:HTMLDivElement,root:Root;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();});
const input=()=>host.querySelector('input')!;
function type(value:string){act(()=>{
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input(),value);
  input().dispatchEvent(new Event('input',{bubbles:true}));
});}
const blur=()=>act(()=>{input().dispatchEvent(new FocusEvent('focusout',{bubbles:true}));});
function Required({initial=4}:{initial?:number}) {
  const [value,setValue]=useState(initial);return <><NumberInput value={value} onValueChange={setValue}/><output>{value}</output></>;
}
describe('shared numeric drafts',()=>{
  it('clears without committing zero, then types 10 without a leading zero',()=>{
    act(()=>root.render(<Required/>));type('');
    expect(input().value).toBe('');expect(host.querySelector('output')!.textContent).toBe('4');
    type('1');type('10');expect(input().value).toBe('10');expect(host.querySelector('output')!.textContent).toBe('10');
  });
  it('allows signs, decimal points and partial exponents, restoring the last valid number on blur',()=>{
    act(()=>root.render(<Required/>));
    for(const partial of ['','-','.','-.','1e-']){type(partial);expect(input().value).toBe(partial);blur();expect(input().value).toBe('4');}
    type('-1.');expect(input().value).toBe('-1.');type('-1.5');blur();expect(input().value).toBe('-1.5');
    type('abc');blur();expect(input().value).toBe('-1.5');
  });
  it('normalizes comma decimals and leading zeros and uses text/decimal mode regardless of French locale',()=>{
    vi.spyOn(Intl,'NumberFormat').mockImplementationOnce(()=>{throw Error('must not format numeric drafts by locale');});
    act(()=>root.render(<Required/>));type('01,25');
    expect(input().type).toBe('text');expect(input().inputMode).toBe('decimal');expect(input().value).toBe('1.25');
    expect(host.querySelector('output')!.textContent).toBe('1.25');blur();expect(input().value).toBe('1.25');
  });
  it('keeps legitimately optional values empty after clearing and blur',()=>{
    function Optional(){const [value,setValue]=useState<number|null>(4);return <><NumberInput optional value={value} onValueChange={setValue}/><output>{value===null?'null':value}</output></>;}
    act(()=>root.render(<Optional/>));type('');blur();expect(input().value).toBe('');expect(host.querySelector('output')!.textContent).toBe('null');
    type('10');blur();expect(input().value).toBe('10');
  });
  it('rejects non-finite and out-of-bounds commits, supports stepping and syncs external updates',()=>{
    const change=vi.fn();
    act(()=>root.render(<NumberInput min={0} max={10} value={4} step=".1" onValueChange={change}/>));
    for(const invalid of ['-1','11','1e999']){type(invalid);blur();expect(input().value).toBe('4');}
    expect(change).not.toHaveBeenCalled();
    act(()=>input().dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true})));
    expect(change).toHaveBeenLastCalledWith(4.1);
    act(()=>root.render(<NumberInput value={8} onValueChange={change}/>));expect(input().value).toBe('8');
  });
  it('formats KPI decimals with dots for either UI language, independently of browser locale',()=>{
    expect(formatNumber(1234.56,2)).toBe('1,234.56');
    expect(formatNumber(19.5)).toBe('19.5');expect(formatNumber(null)).toBe('—');expect(formatNumber(NaN)).toBe('—');
  });
});
