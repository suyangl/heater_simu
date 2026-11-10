import {describe,it,expect} from 'vitest';
import {clampPosition,makeSampler,postureHeights,readProbe,restoreProbe} from './probe';
import type {Project} from './s1';
const encode=(values:number[])=>btoa(String.fromCharCode(...new Uint8Array(new Float32Array(values).buffer)));
const field=(values=[0,1,10,11,100,101,110,111])=>({
  grid:{nx:2,ny:2,nz:2,origin:[.5,1,2],spacing:[2,3,4]},T:{data:encode(values)}
});
const p:Project={room:{length:4,width:3,height:2.5},exterior_wall:'N',window:{offset:1,width:1,height:1,sill:1},
  dpe:'C',outdoor_temp:5,heater:{power_w:1500,setpoint_c:20,wall:'N',offset:1,z:.1,length:.8,depth:.1,height:.5},
  furniture:[{x:1,y:1,z:.2,l:2,w:1,h:.5}]};
describe('probe sampler',()=>{
  it('interpolates exact grid points, midpoints and nonuniform spacing in x-fastest order',()=>{
    const sample=makeSampler(field());
    expect(sample(2.5,1,6)).toEqual({value:101,nearest:false});
    expect(sample(1.5,2.5,4)).toEqual({value:55.5,nearest:false});
    expect(sample(1,1,2).value).toBe(.25);
  });
  it('uses nearest valid air for masked corners, solid interiors and outside points',()=>{
    const sample=makeSampler(field([NaN,1,10,11,100,101,110,111]));
    expect(sample(.5,1,2)).toEqual({value:1,nearest:true});
    expect(sample(-20,1,2)).toEqual({value:10,nearest:true});
    const solid=makeSampler(field(),[{x:.4,y:.9,z:1.9,l:.2,w:.2,h:.2}]);
    expect(solid(.5,1,2)).toEqual({value:1,nearest:true});
  });
  it('returns unavailable for no field, all invalid air, malformed data/grid and nonfinite coordinates',()=>{
    expect(makeSampler(null)(1,1,1).value).toBeNull();
    expect(makeSampler(field(Array(8).fill(NaN)))(1,1,1).value).toBeNull();
    expect(makeSampler({...field(),T:{data:'!'}})(1,1,1).value).toBeNull();
    expect(makeSampler({...field(),grid:{...field().grid,spacing:[0,1,1]}})(1,1,1).value).toBeNull();
    expect(makeSampler(field())(NaN,1,1).value).toBeNull();
  });
});
describe('probe posture and preferences',()=>{
  it('clamps position, restores persisted settings and rejects corrupt storage',()=>{
    expect(clampPosition({x:8,y:-2},p.room)).toEqual({x:4,y:0});
    expect(restoreProbe('{"posture":"lying","x":2,"y":1.5}',p.room)).toEqual({posture:'lying',x:2,y:1.5});
    expect(restoreProbe('bad',p.room)).toEqual({posture:'standing',x:2,y:1.5});
    expect(restoreProbe('{"posture":"bad","x":"bad","y":null}',p.room)).toEqual({posture:'standing',x:2,y:1.5});
  });
  it('uses standing/sitting heights and adds furniture top only for lying, clamped to room height',()=>{
    const settings={posture:'standing' as const,x:2,y:1.5};
    expect(postureHeights(settings,p)).toEqual({head:1.6,ankle:.1,body:.4});
    expect(postureHeights({...settings,posture:'sitting'},p).head).toBe(1.1);
    expect(postureHeights({...settings,posture:'lying'},p).body).toBeCloseTo(1.1);
    expect(postureHeights({posture:'lying',x:0,y:0},p).body).toBe(.4);
    expect(postureHeights({...settings,posture:'lying'},{...p,room:{...p.room,height:.8}}).body).toBe(.8);
    expect(postureHeights(settings,{...p,room:{...p.room,height:1.2}}).head).toBe(1.2);
  });
  it('classifies relative to setpoint ±1 °C and flags vertical differences above 3 °C',()=>{
    const settings={posture:'standing' as const,x:2,y:1.5};
    const uniform=(value:number)=>(_x:number,_y:number,_z:number)=>({value,nearest:false});
    expect(readProbe(uniform(19),p,settings).comfort).toBe('comfortable');
    expect(readProbe(uniform(18),p,settings).comfort).toBe('cool');
    expect(readProbe(uniform(22),p,settings).comfort).toBe('warm');
    const stratified=(_x:number,_y:number,z:number)=>({value:18+3*z,nearest:false});
    expect(readProbe(stratified,p,settings).warning).toBe(true);
    const lying=readProbe(stratified,p,{...settings,posture:'lying'});
    expect(lying.warning).toBe(false);
    expect(lying.body.value).toBeCloseTo(21.3);
    expect(readProbe(makeSampler(null),p,settings).comfort).toBe('unavailable');
  });
});
