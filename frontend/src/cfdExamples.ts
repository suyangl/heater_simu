import {matchPreset,Prediction,Project,Table} from './s1';
import type {VisualFields} from './ResultLayers';
import {restoreStaticProject} from './staticProject';

export type CFDExample={id:string;template:string;position:string;dpe:string;setpoint_c:number;outdoor_temp:number;project:Project};
export type CFDIndex={version:number;cases:CFDExample[]};
export type ExampleResult=Omit<NonNullable<Prediction['field']>,'source'>&VisualFields&{source?:string};
export type ExampleChoice={entry:CFDExample;exact:boolean};
const grades='ABCDEFG',validId=(id:unknown)=>typeof id==='string'&&/^[A-Za-z0-9_-]+$/.test(id);

export function chooseCFDExample(p:Project,table:Table,index:CFDIndex):ExampleChoice|null {
  const match=matchPreset(p,table);
  if(!match||!grades.includes(p.dpe))return null;
  const entries=index.cases.filter(e=>e.template===match.template&&e.position===match.position).sort((a,b)=>
    Math.abs(grades.indexOf(a.dpe)-grades.indexOf(p.dpe))-Math.abs(grades.indexOf(b.dpe)-grades.indexOf(p.dpe))||a.id.localeCompare(b.id));
  const entry=entries[0];if(!entry)return null;
  const exact=entry.dpe===p.dpe&&entry.project.outdoor_temp===p.outdoor_temp&&
    entry.project.heater.setpoint_c===p.heater.setpoint_c&&entry.project.heater.power_w===p.heater.power_w&&
    !!matchPreset(p,{...table,tolerance_m:1e-8,presets:{[entry.template]:{[entry.position]:entry.project}}});
  return {entry,exact};
}
export function combineExample(s1:ExampleResult|null,choice:ExampleChoice|null,example:ExampleResult|null):ExampleResult|null {
  if(!choice||!example)return s1;
  if(choice.exact)return example;
  return s1?{...s1,streamlines:example.streamlines,isosurface:example.isosurface,U:example.U}:null;
}
export function createExampleLoader(fetcher:typeof fetch=fetch) {
  const cache=new Map<string,Promise<ExampleResult>>();
  async function json(url:string) {
    const response=await fetcher(url);
    if(!response.ok)throw Error('CFD example unavailable');
    return response.json();
  }
  async function loadIndex():Promise<CFDIndex> {
    const index=await json('/cfd-examples/index.json');
    if(index?.version!==1||!Array.isArray(index.cases)||!index.cases.every((e:CFDExample)=>validId(e.id)&&
      typeof e.template==='string'&&typeof e.position==='string'&&grades.includes(e.dpe)&&
      restoreStaticProject(JSON.stringify({version:1,project:e.project}))))throw Error('Invalid CFD example index');
    return index;
  }
  async function loadCase(entry:CFDExample):Promise<ExampleResult> {
    if(!validId(entry.id))throw Error('Invalid CFD example id');
    let pending=cache.get(entry.id);
    if(!pending){
      pending=json('/cfd-examples/'+entry.id+'.json').then(result=>{
        const numbers=['room_average_c','heat_loss_w','energy_balance_error','solve_wall_time_s','cell_count',
          'rated_power_w','cfd_heater_power_w','analytic_effective_power_w','thermostat_iterations','duty_cycle'];
        if(!result?.grid||typeof result.T?.data!=='string'||!['min','max','mean'].every(k=>Number.isFinite(result.T[k]))||
          !numbers.every(k=>Number.isFinite(result.kpi?.[k])))throw Error('Invalid CFD example result');
        return result as ExampleResult;
      }).catch(error=>{cache.delete(entry.id);throw error;});
      cache.set(entry.id,pending);
    }
    return pending;
  }
  return {loadIndex,loadCase};
}
