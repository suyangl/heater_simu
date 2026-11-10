import {describe,it,expect} from 'vitest';
import {Project} from './s1';
import {addFurniture,commit,dragOpening,fitBox,historyOf,moveBox,placeHeater,redo,resizeBox,resizeRoom,rotateBox,snap,undo,validatePlan} from './plan';
const fixture=():Project=>({room:{length:4,width:3.5,height:2.5},exterior_wall:'N',window:{offset:1,width:1,height:1,sill:1},dpe:'C',outdoor_temp:5,heater:{wall:'N',offset:1,length:.8,depth:.1,height:.5,z:.15,power_w:1500,setpoint_c:19},furniture:[{x:.2,y:.2,z:0,l:1.9,w:1.4,h:.55}]});
describe('plan editing',()=>{
  it('snaps at 5cm, can bypass snapping, and clamps inside the room',()=>{
    expect(snap(.173)).toBe(.15);expect(snap(.173,0)).toBe(.173);
    const p=fixture(),b=moveBox(p,0,20,-2).furniture[0];expect(b.x).toBeCloseTo(2.1);expect(b.y).toBe(0);
    expect(p.furniture[0].x).toBe(.2);expect(fitBox(p,{...b,l:20}).l).toBe(4);
  });
  it('resizes all corners with API minimums, rotates and reclamps',()=>{
    const p=fixture();
    for(const corner of ['ne','nw','se','sw']){
      const b=resizeBox(p,0,corner,{x:corner.includes('e')?-10:20,y:corner.includes('n')?-10:20}).furniture[0];
      expect(b.l).toBeCloseTo(.08);expect(b.w).toBeCloseTo(.08);
    }
    const moved=moveBox(p,0,2.1,2.1),rotated=rotateBox(moved,0).furniture[0];
    expect(rotated.l).toBe(1.4);expect(rotated.w).toBe(1.9);expect(rotated.y+rotated.w).toBeLessThanOrEqual(3.5);
    expect(resizeRoom(p,1,20).room).toEqual({length:2,width:8,height:2.5});
  });
  it('keeps legacy openings on their wall without materializing modern fields',()=>{
    const p=fixture(),m=dragOpening(p,0,20);
    expect(m.openings).toBeUndefined();expect(m.window.offset).toBe(3);expect(m.exterior_wall).toBe('N');
    expect(dragOpening(p,0,20,'start').window.width).toBeCloseTo(.2);
    expect(dragOpening(p,0,20,'end').window.width).toBe(3);
    const modern={...p,openings:[{...p.window,type:'window' as const,wall:'E' as const}]};
    expect(dragOpening(modern,0,20).openings![0]).toMatchObject({wall:'E',offset:2.5});
  });
  it('switches heater wall using the nearest wall and clamps offset',()=>{
    const p=fixture(),next=placeHeater(p,{x:4,y:2});
    expect(next.heater.wall).toBe('E');expect(next.heater.offset).toBe(1.6);
    expect(placeHeater(p,{x:-1,y:-1}).heater.offset).toBe(0);
  });
  it('detects collisions, out-of-bounds, openings, blocked openings and forward clearance',()=>{
    const p=fixture();expect(validatePlan(p)).toEqual([]);
    p.furniture[0]={x:1,y:3.1,z:0,l:.5,w:.2,h:.7};
    expect(validatePlan(p).some(i=>i.warning&&i.message==='plan.clearance')).toBe(true);
    p.furniture[0].y=3.35;
    expect(validatePlan(p).some(i=>i.message==='家具或暖器重叠')).toBe(true);
    p.furniture[0].x=5;
    expect(validatePlan(p).some(i=>i.message==='家具或暖器超出房间')).toBe(true);
    p.openings=[{...p.window,wall:'S',type:'window'},{...p.window,wall:'S',type:'door',sill:0,height:2}];
    expect(validatePlan(p).some(i=>i.message==='窗户只能位于外墙')).toBe(true);
    expect(validatePlan(p).some(i=>i.message==='同一墙面的门窗重叠')).toBe(true);
    p.openings[0].offset=4;
    expect(validatePlan(p).some(i=>i.message==='门窗超出墙面')).toBe(true);
    p.furniture=[{x:1,y:0,z:0,l:1,w:.5,h:2}];p.openings[0].offset=1;
    expect(validatePlan(p).some(i=>i.message==='家具或暖器遮挡门窗')).toBe(true);
  });
  it('validates numeric API limits, empty exterior walls, limits and zero opaque area',()=>{
    const p=fixture();p.room.height=5;p.heater.power_w=3000;p.furniture[0].l=.01;
    expect(validatePlan(p).filter(i=>i.message==='plan.range')).toHaveLength(3);
    expect(validatePlan({...fixture(),exterior_walls:[]}).some(i=>i.message==='plan.exterior')).toBe(true);
    const full=fixture();full.window={offset:0,width:4,height:2.5,sill:0};
    expect(validatePlan(full).some(i=>i.message==='需要非零不透明外墙面积')).toBe(true);
  });
  it('adds defaults and duplicates without exceeding the 15-box API limit',()=>{
    const p=fixture(),next=addFurniture(p,'bed');
    expect(next.furniture[1]).toMatchObject({kind:'bed',l:1.9,w:1.4,h:.55});
    expect(addFurniture({...p,furniture:Array(15).fill(p.furniture[0])},'bed').furniture).toHaveLength(15);
  });
  it('round-trips unchanged projects byte-identically and maintains undo/redo, branching and no-op history',()=>{
    const p=fixture(),bytes=JSON.stringify(p),h=historyOf(p);
    expect(JSON.stringify(h.present)).toBe(bytes);expect(commit(h,structuredClone(p))).toBe(h);
    const changed=commit(h,moveBox(p,0,1,1)),back=undo(changed);
    expect(JSON.stringify(back.present)).toBe(bytes);expect(redo(back).present).toEqual(changed.present);
    expect(commit(back,resizeRoom(p,5,4)).future).toEqual([]);
    expect(undo(h)).toBe(h);expect(redo(h)).toBe(h);
  });
});
