import {describe,it,expect} from 'vitest';
import {predict,prepare,ua,Table,Project} from './s1';

const project:Project={room:{length:4,width:3.5,height:2.5},exterior_wall:'N',window:{offset:1.2,width:1.2,height:1.35,sill:.9},dpe:'F',outdoor_temp:5,heater:{power_w:1500,setpoint_c:19,wall:'N',offset:1.3,z:.15,length:.8,depth:.1,height:.5},furniture:[]};
function fixture():Table {
  return {version:'s1-v1',grid:{nx:2,ny:2,nz:2},tolerance_m:.02,
    axes:{templates:['room'],positions:['under_window'],u_values:{A:[.15,.8],B:[.25,1.1],C:[.35,1.4],F:[1.5,3.5]},ach:{A:.3,B:.4,C:.5,F:.9}},
    presets:{room:{under_window:structuredClone(project)}},availability:[{available:true}],
    cases:[{id:'a',template:'room',position:'under_window',dpe:'A',wall_u:.15,k:.5,theta:{min:1,scale:1,data:btoa('\0'.repeat(16))}},
      {id:'c',template:'room',position:'under_window',dpe:'C',wall_u:.35,k:.7,theta:{min:1,scale:1,data:btoa('\0'.repeat(16))}}]};
}
describe('S1 physical scaling and confidence',()=>{
  it('ports the Python UA formula',()=>expect(ua(project,fixture())*14).toBeCloseTo(405.3));
  it('interpolates k by wall U and scales temperature/power',()=>{
    const p={...structuredClone(project),dpe:'B'},t=prepare(fixture());
    const prediction=predict(p,t);expect(prediction.confidence).toBe('高');
    expect(prediction.field!.kpi.room_average_c).toBe(19);
    expect(prediction.field!.kpi.cfd_heater_power_w).toBeCloseTo(.6*ua(p,t)*14);
    p.outdoor_temp=-9;
    expect(predict(p,t).field!.kpi.cfd_heater_power_w).toBeCloseTo(2*prediction.field!.kpi.cfd_heater_power_w);
    expect(predict(p,t).field!.T.mean).toBe(19);
  });
  it('flags nearest extrapolation and capacity without capping required power',()=>{
    const p=structuredClone(project);p.heater.power_w=10;
    const r=predict(p,fixture());expect(r.confidence).toBe('中');expect(r.extrapolated).toBe(true);
    expect(r.field!.kpi.insufficient_power).toBe(true);expect(r.field!.kpi.cfd_heater_power_w).toBeGreaterThan(10);
  });
  it('scales the spatial field rather than only its mean KPI',()=>{
    const t=fixture();for(const row of t.cases)row.theta.min=.5;
    const p=structuredClone(project);p.dpe='A';
    expect(predict(p,t).field!.T.min).toBe(12);
    p.outdoor_temp=-9;expect(predict(p,t).field!.T.min).toBe(5);
    p.heater.setpoint_c=25;expect(predict(p,t).field!.T.max).toBe(8);
  });
  it('rejects custom geometry, missing categorical groups and no cooling',()=>{
    const t=fixture(),p=structuredClone(project);p.room.length=4.1;
    expect(predict(p,t).confidence).toBe('低');expect(predict(p,t).field).toBeNull();
    t.cases=[];expect(predict(project,t).field).toBeNull();
    expect(predict({...project,outdoor_temp:25},fixture()).field).toBeNull();
  });
  it('accepts only documented geometry tolerance and exact known U nodes',()=>{
    const p=structuredClone(project);p.room.length+=.01;p.dpe='A';
    expect(predict(p,fixture()).confidence).toBe('高');
    p.heater.offset+=.1;expect(predict(p,fixture()).field).toBeNull();
  });
});
