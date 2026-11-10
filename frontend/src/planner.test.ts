import {describe,it,expect} from 'vitest';
import {defaultSchedule,newProfile,restoreSettings,evaluateTariff} from './billing';
import {analyticBreakdown,analyticUA,UNMODIFIED} from './envelope';
import {Project,Table} from './s1';
import {applyMeasures,buildPlanner,combinedPlan,measuresFor,restorePlanner,simulateApplied} from './planner';
function fixture(){
  const project:Project={room:{length:4,width:3.5,height:2.5},exterior_wall:'N',window:{offset:1.2,width:1.2,height:1.35,sill:.9},dpe:'C',outdoor_temp:5,
    heater:{power_w:2000,setpoint_c:20,wall:'N',offset:1.3,z:.15,length:.8,depth:.1,height:.5},furniture:[]};
  const alternate=structuredClone(project);alternate.heater.wall='S';
  const axes={templates:['room'],positions:['under_window','opposite_wall'],u_values:{A:[.15,.8] as [number,number],C:[.35,1.4] as [number,number]},ach:{A:.3,C:.5}};
  const table:Table={version:'s1-v1',grid:{nx:2,ny:2,nz:2},tolerance_m:.02,axes,
    presets:{room:{under_window:project,opposite_wall:alternate}},availability:[{available:true},{available:true}],
    cases:['under_window','opposite_wall'].map((position,i)=>({id:position,template:'room',position,dpe:'C',wall_u:.35,k:i?.6:.8,theta:{min:1,scale:1,data:btoa('\0'.repeat(16))}}))};
  const settings=restoreSettings(null,20);
  settings.profiles=[{...newProfile('base','Base'),base:.2,subscription:10},
    {...newProfile('hp','HPHC','hphc'),hp:.18,hc:.1,subscription:8}];settings.active='base';
  settings.climate={amplitude:0,months:settings.climate.months.map(m=>({...m,mean:5}))};
  settings.schedule.weekdays=Array(24).fill(true);settings.schedule.weekends=Array(24).fill(true);
  return {project,settings,table,calibratedUA:40,analytic:analyticBreakdown(project,table)};
}
describe('saving planner scenarios',()=>{
  it('computes a plausible steady −1°C saving rather than a fixed percentage',()=>{
    const input=fixture(),prefs=restorePlanner(null),result=buildPlanner(input,prefs);
    const c=result.candidates.find(c=>c.measure.id==='setpoint-1')!;
    expect(c.kwh/result.baseline.consumption.kwh).toBeCloseTo(1/15,8);
    expect(c.euros).toBeCloseTo(c.kwh*.2,8);expect(c.co2).toBeCloseTo(c.kwh*.079,8);
    expect(c.scenario.project.heater.setpoint_c).toBe(19);expect(c.comfortPp).toBe(0);
    expect(c.payback).toBeNull();
  });
  it('changes only independent billing comfort when followProject is off, preserving the CFD project',()=>{
    const input=fixture(),prefs=restorePlanner(null);
    input.settings.followProject=false;input.settings.schedule.comfort=22;
    const before=JSON.stringify(input.project);
    const independent=buildPlanner(input,prefs).candidates.find(c=>c.measure.id==='setpoint-1')!.apply();
    expect(JSON.stringify(independent.project)).toBe(before);
    expect(independent.settings.followProject).toBe(false);
    expect(independent.settings.schedule.comfort).toBe(21);
    input.settings.followProject=true;
    const linked=buildPlanner(input,prefs).candidates.find(c=>c.measure.id==='setpoint-1')!.apply();
    expect(linked.project.heater.setpoint_c).toBe(19);
    expect(linked.settings.schedule.comfort).toBe(19);
    expect(linked.settings.followProject).toBe(true);
  });
  it('combined modifications equal direct RC simulation and do not sum individual savings',()=>{
    const input=fixture(),prefs=restorePlanner(null);
    const selected=measuresFor(input).filter(m=>['setpoint-1','curtains','draught'].includes(m.id));
    const combined=combinedPlan(input,selected,prefs);
    const direct=simulateApplied(applyMeasures(input,selected,prefs.assumptions));
    expect(combined.scenario.consumption.kwh).toBe(direct.consumption.kwh);
    expect(combined.scenario.bill.total).toBe(direct.bill.total);
    const individual=buildPlanner(input,prefs).candidates.filter(c=>selected.some(m=>m.id===c.measure.id)).reduce((sum,c)=>sum+c.kwh,0);
    expect(Math.abs(individual-combined.kwh)).toBeGreaterThan(.1);
    expect(combined.investment).toBeNull();expect(combined.payback).toBeNull();
    for(const m of selected)prefs.costs[m.id]=10;
    const costed=combinedPlan(input,selected,prefs);
    expect(costed.investment).toBe(30);expect(costed.payback).toBeCloseTo(30/costed.euros!,8);
  });
  it('reuses consumption for tariff switches and matches the exact bill difference',()=>{
    const input=fixture(),result=buildPlanner(input,restorePlanner(null)),c=result.candidates.find(c=>c.measure.id==='tariff-hp')!;
    const other=evaluateTariff(result.baseline.consumption,input.settings.profiles[1],2000);
    expect(c.euros).toBeCloseTo(result.baseline.bill.total!-other.total!,8);
    expect(c.scenario.consumption).toBe(result.baseline.consumption);expect(c.kwh).toBe(0);
    expect(c.scenario.settings.active).toBe('hp');
  });
  it('reduces calibrated UA via analytic ratios for retrofits and DPE upgrades',()=>{
    const input=fixture(),prefs=restorePlanner(null),result=buildPlanner(input,prefs);
    expect(input.analytic.opaque+input.analytic.windows+input.analytic.doors+input.analytic.infiltration).toBeCloseTo(input.analytic.total,8);
    for(const id of ['curtains','film','draught','dpe-1','dpe-2']){
      const c=result.candidates.find(c=>c.measure.id===id)!;
      expect(c.scenario.ua).toBeLessThan(40);
      expect(c.scenario.ua).toBeCloseTo(40*analyticUA(c.scenario.project,input.table,c.scenario.settings.envelope??UNMODIFIED)/input.analytic.total,8);
    }
    expect(result.candidates.find(c=>c.measure.id==='curtains')!.scenario.settings.envelope!.windowFactor).toBe(.85);
    expect(input.settings.envelope).toBeUndefined();expect(input.project.dpe).toBe('C');
  });
  it('offers only available template positions, with an S1 power ratio',()=>{
    const input=fixture(),prefs=restorePlanner(null),result=buildPlanner(input,prefs);
    const c=result.candidates.find(c=>c.measure.kind==='position')!;
    expect(c.scenario.project.heater.wall).toBe('S');expect(c.scenario.ua).toBeCloseTo(30,8);
    const custom={...input,project:{...input.project,room:{...input.project.room,length:4.5}}};
    expect(measuresFor(custom).some(m=>m.kind==='position')).toBe(false);
    expect(buildPlanner(custom,prefs).positionTip).toBe(true);
    expect(measuresFor({...input,table:null}).some(m=>m.kind==='position')).toBe(false);
    expect(measuresFor({...input,table:{...input.table,cases:input.table.cases.slice(0,1)}}).some(m=>m.kind==='position')).toBe(false);
  });
  it('ranks by kWh with incomplete tariffs and never invents euro savings',()=>{
    const input=fixture();input.settings.profiles[0].base=null;
    const result=buildPlanner(input,restorePlanner(null));
    expect(result.ranking).toBe('kwh');expect(result.candidates.every(c=>c.euros===null&&c.payback===null)).toBe(true);
    expect(result.candidates.every((c,i)=>!i||result.candidates[i-1].kwh>=c.kwh)).toBe(true);
  });
  it('rejects contradictory variants and invalid assumptions, including corrupt storage',()=>{
    const input=fixture(),prefs=restorePlanner(null),m=measuresFor(input);
    expect(()=>applyMeasures(input,m.filter(v=>v.kind==='setpoint'),prefs.assumptions)).toThrow('planner.conflict');
    expect(()=>applyMeasures(input,[],{...prefs.assumptions,film:0})).toThrow('planner.invalidAssumptions');
    for(const raw of ['bad','null','{}',JSON.stringify({...prefs,assumptions:{...prefs.assumptions,emission:-1}})])expect(restorePlanner(raw)).toEqual(prefs);
    prefs.selected=['curtains'];prefs.costs.curtains=150;
    expect(restorePlanner(JSON.stringify(prefs))).toEqual(prefs);
  });
  it('handles an empty plan, no windows, missing investment and zero-cost investments',()=>{
    const input=fixture(),prefs=restorePlanner(null),empty=combinedPlan(input,[],prefs);
    expect(empty.kwh).toBe(0);expect(empty.euros).toBe(0);expect(empty.payback).toBeNull();
    const c=buildPlanner(input,prefs).candidates.find(c=>c.measure.id==='setpoint-1')!;
    prefs.costs[c.measure.id]=0;
    expect(buildPlanner(input,prefs).candidates.find(v=>v.measure.id===c.measure.id)!.payback).toBe(0);
    expect(measuresFor({...input,analytic:{...input.analytic,windows:0,infiltration:0}}).some(m=>['curtains','film','draught'].includes(m.kind))).toBe(false);
  });
  it('reports worse comfort, increased cost and no payback for an adverse position',()=>{
    const input=fixture(),prefs=restorePlanner(null);input.project.heater.power_w=1000;
    input.table.cases[1].k=1.6;prefs.costs['position-opposite_wall']=100;
    const c=buildPlanner(input,prefs).candidates.find(c=>c.measure.kind==='position')!;
    expect(c.comfortPp).toBeLessThan(0);expect(c.euros).toBeLessThan(0);expect(c.payback).toBeNull();
  });
  it('keeps applied RC-only retrofits in billing persistence and avoids offering them twice',()=>{
    const input=fixture(),prefs=restorePlanner(null);
    const state=applyMeasures(input,measuresFor(input).filter(m=>['curtains','draught'].includes(m.id)),prefs.assumptions);
    const restored=restoreSettings(JSON.stringify(state.settings),20);
    expect(restored.envelope).toEqual({windowFactor:.85,achFactor:.8});
    expect(measuresFor({...input,settings:restored}).some(m=>['curtains','film','draught'].includes(m.kind))).toBe(false);
  });
  it('compares schedules consistently after applying −1°C with followProject enabled',()=>{
    const input=fixture(),prefs=restorePlanner(null);
    input.project.room={length:3.5,width:3,height:2.5};input.project.heater.setpoint_c=19;
    input.project.heater.power_w=1500;input.calibratedUA=5.916297293170128;
    input.settings.schedule=defaultSchedule(19);input.settings.climate=restoreSettings(null,19).climate;
    const current={...input,table:null,analytic:analyticBreakdown(input.project,null)};
    const state=applyMeasures(current,measuresFor(current).filter(m=>m.id==='setpoint-1'),prefs.assumptions);
    const plan=buildPlanner({...current,project:state.project,settings:state.settings},prefs);
    expect(state.project.heater.setpoint_c).toBe(18);
    expect(state.settings.followProject).toBe(true);expect(state.settings.schedule.eco).toBe(16);
    for(const id of ['eco-15','shorten']){
      const c=plan.candidates.find(c=>c.measure.id===id)!;
      expect(c.kwh).toBeGreaterThanOrEqual(-1e-8);expect(c.euros!).toBeGreaterThanOrEqual(-1e-8);
      expect(c.scenario.settings.schedule.comfort).toBe(18);
    }
  });
});
