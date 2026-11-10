import {describe,it,expect} from 'vitest';
import {breathingScale,clampPosition,makeSampler,probePose,postureHeights,readProbe,restoreProbe} from './probe';
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
  it('breathes gently at 0.25 Hz and disables animation for reduced motion',()=>{
    expect(breathingScale(1,false)).toBeCloseTo(1.025);
    expect(breathingScale(3,false)).toBe(1);
    expect(breathingScale(0,false)).toBeCloseTo(breathingScale(4,false));
    expect(breathingScale(1,true)).toBe(1);
  });
  it('clamps position, restores persisted settings and rejects corrupt storage',()=>{
    expect(clampPosition({x:8,y:-2},p.room)).toEqual({x:4,y:0});
    expect(restoreProbe('{"posture":"lying","x":2,"y":1.5}',p.room)).toEqual({posture:'lying',x:2,y:1.5});
    expect(restoreProbe('bad',p.room)).toEqual({posture:'standing',x:2,y:1.5});
    expect(restoreProbe('{"posture":"bad","x":"bad","y":null}',p.room)).toEqual({posture:'standing',x:2,y:1.5});
  });
  it('uses supported sitting heights and lying air offsets, clamped to room height',()=>{
    const settings={posture:'standing' as const,x:2,y:1.5};
    expect(postureHeights(settings,p)).toEqual({head:1.6,ankle:.1,body:.4});
    expect(postureHeights({...settings,posture:'sitting'},p).head).toBeCloseTo(.7+.025+.68);
    expect(postureHeights({...settings,posture:'lying'},p).body).toBeCloseTo(1.1);
    expect(postureHeights({posture:'lying',x:0,y:0},p).body).toBe(.4);
    expect(postureHeights({...settings,posture:'lying'},{...p,room:{...p.room,height:.8}}).body).toBe(.8);
    expect(postureHeights(settings,{...p,room:{...p.room,height:1.2}}).head).toBe(1.2);
  });
  it('lays the whole figure along the longer support axis and keeps it on the surface',()=>{
    const horizontal=probePose({posture:'lying',x:1.1,y:1.05},p);
    expect(horizontal.axis).toBe('x');
    expect(horizontal.support).toBeCloseTo(.7);
    expect(horizontal.length).toBeCloseTo(1.7);
    expect(horizontal.x-horizontal.length/2).toBeGreaterThanOrEqual(1);
    expect(horizontal.y-horizontal.width/2).toBeGreaterThanOrEqual(1);
    const vertical=probePose({posture:'lying',x:1.1,y:.6},{...p,furniture:[{x:1,y:.5,z:0,l:1,w:2,h:.6}]});
    expect(vertical.axis).toBe('y');
    expect(vertical.yaw).toBe(Math.PI/2);
    expect(vertical.x-vertical.width/2).toBeGreaterThanOrEqual(1);
    expect(vertical.y-vertical.length/2).toBeGreaterThanOrEqual(.5);
  });
  it('uses the floor with no furniture and the highest surface when supports overlap',()=>{
    const settings={posture:'lying' as const,x:0,y:0};
    const floor=probePose(settings,{...p,furniture:[]});
    expect(floor.support).toBe(0);
    expect(floor.x).toBe(floor.length*1.8/1.7/2);
    expect(floor.y).toBe(floor.width/2);
    expect(probePose({...settings,x:2,y:1.5},{...p,furniture:[...p.furniture,{x:1,y:1,z:0,l:2,w:1,h:.9}]}).support).toBe(.9);
    const small=probePose({posture:'lying',x:1.2,y:1.2},{...p,furniture:[{x:1,y:1,z:0,l:.5,w:.4,h:.5}]});
    expect(small.length).toBeLessThan(.5);
    expect(small.length).toBeCloseTo(.5*.9);
    expect(small.width).toBeLessThan(.4);
    const tiny=probePose({posture:'lying',x:1.01,y:1.01},{...p,furniture:[{x:1,y:1,z:0,l:.02,w:.02,h:.5}]});
    expect(tiny.length).toBeGreaterThan(0);
    expect(tiny.length*1.8/1.7).toBeLessThan(.02);
    expect(tiny.width).toBeGreaterThan(0);
  });
  it('sits on the nearest box edge facing outward, sampling its actual head and extended ankles',()=>{
    const settings={posture:'sitting' as const,x:2,y:1.4},pose=probePose(settings,p);
    expect(pose.y).toBe(1);
    expect(pose.yaw).toBe(Math.PI);
    expect(pose.seat).toBeCloseTo(.725);
    const reading=readProbe((x,y,z)=>({value:x+10*y+z,nearest:false}),p,settings);
    expect(reading.head.value).toBeCloseTo(2+10+.725+.68);
    expect(reading.ankle.value).toBeCloseTo(2+10*.64+.725-.48);
    expect(probePose({...settings,x:2.9,y:1.5},p).yaw).toBe(Math.PI/2);
    expect(probePose({...settings,x:1.1,y:1.5},p).yaw).toBe(-Math.PI/2);
    expect(probePose({...settings,x:2,y:1.9},p).yaw).toBe(0);
    const floor=postureHeights({...settings,x:0,y:0},{...p,furniture:[]});
    expect(floor.head).toBeCloseTo(.76);
    expect(floor.ankle).toBe(.1);
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
