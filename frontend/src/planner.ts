import {BillingSettings,Price,evaluateTariff,simulateSeason,tariffError} from './billing';
import {Project,Table,matchPreset,predict} from './s1';
import {UNMODIFIED,analyticBreakdown,analyticUA} from './envelope';
import {translate} from './i18n';
export type Assumptions={emission:number;curtains:number;film:number;draught:number};
// Illustrative ADEME Base Carbone / DPE-2021 electric-heating convention:
// 0.079 kgCO2e/kWh (France). Editable, not a live grid-mix factor.
// Source: https://base-empreinte.ademe.fr/ ; no emissions/price data is fetched.
export const DEFAULT_ASSUMPTIONS:Assumptions={emission:.079,curtains:.85,film:.9,draught:.8};
export type PlannerInput={project:Project;calibratedUA:number;analytic:ReturnType<typeof analyticBreakdown>;settings:BillingSettings;table:Table|null};
export type Measure={id:string;category:'setpoint'|'schedule'|'tariff'|'retrofit'|'envelope'|'position';group:string;
  kind:'setpoint'|'eco'|'shorten'|'tariff'|'curtains'|'film'|'draught'|'dpe'|'position';amount?:number;target?:string};
export type PlannerPreferences={version:1;selected:string[];costs:Record<string,Price>;assumptions:Assumptions};
export const PLANNER_STORAGE='heatsimu.planner.v1';
export function restorePlanner(raw:string|null):PlannerPreferences {
  const fallback:PlannerPreferences={version:1,selected:[],costs:{},assumptions:{...DEFAULT_ASSUMPTIONS}};
  try{
    const p=JSON.parse(raw??'null') as PlannerPreferences;
    if(p?.version!==1||!Array.isArray(p.selected)||!p.selected.every(v=>typeof v==='string')||
      !p.costs||typeof p.costs!=='object'||Array.isArray(p.costs)||
      !Object.values(p.costs).every(v=>v===null||(Number.isFinite(v)&&v>=0))||!validAssumptions(p.assumptions))return fallback;
    return {...p,selected:[...new Set(p.selected)]};
  }catch{return fallback;}
}
export function validAssumptions(a:Assumptions) {
  return !!a&&Number.isFinite(a.emission)&&a.emission>=0&&[a.curtains,a.film,a.draught].every(v=>Number.isFinite(v)&&v>0&&v<=1);
}
export function measuresFor(input:PlannerInput):Measure[] {
  const {project:p,settings:s,table}=input,comfort=s.followProject?p.heater.setpoint_c:s.schedule.comfort;
  const measures:Measure[]=[];
  for(const n of [1,2])if(comfort-n>=s.schedule.eco)measures.push({id:'setpoint-'+n,category:'setpoint',group:'setpoint',kind:'setpoint',amount:n});
  if(s.schedule.eco>15&&comfort>=15)measures.push({id:'eco-15',category:'schedule',group:'eco',kind:'eco',amount:15});
  if([...s.schedule.weekdays,...s.schedule.weekends].some(Boolean))measures.push({id:'shorten',category:'schedule',group:'hours',kind:'shorten'});
  for(const profile of s.profiles)if(profile.id!==s.active&&!tariffError(profile))measures.push({id:'tariff-'+profile.id,category:'tariff',group:'tariff',kind:'tariff',target:profile.id});
  if(input.analytic.windows>0&&(s.envelope?.windowFactor??1)===1)for(const kind of ['curtains','film'] as const)measures.push({id:kind,category:'retrofit',group:'window',kind});
  if(input.analytic.infiltration>0&&(s.envelope?.achFactor??1)===1)measures.push({id:'draught',category:'retrofit',group:'ach',kind:'draught'});
  const grade='ABCDEFG'.indexOf(p.dpe);
  for(const n of [1,2])if(grade>=n)measures.push({id:'dpe-'+n,category:'envelope',group:'dpe',kind:'dpe',amount:n,target:'ABCDEFG'[grade-n]});
  const match=table&&matchPreset(p,table);
  if(table&&match&&predict(p,table).field)for(const position of Object.keys(table.presets[match.template])){
    if(position===match.position)continue;
    const alt={...p,heater:{...table.presets[match.template][position].heater,power_w:p.heater.power_w,setpoint_c:p.heater.setpoint_c}};
    if(predict(alt,table).field)measures.push({id:'position-'+position,category:'position',group:'position',kind:'position',target:position});
  }
  return measures;
}
export function applyMeasures(input:PlannerInput,measures:Measure[],assumptions:Assumptions) {
  if(!validAssumptions(assumptions))throw Error('planner.invalidAssumptions');
  if(new Set(measures.map(m=>m.group)).size!==measures.length)throw Error('planner.conflict');
  const p=structuredClone(input.project),s=structuredClone(input.settings);
  const initialComfort=s.followProject?p.heater.setpoint_c:s.schedule.comfort;
  const modifiers={...(s.envelope??UNMODIFIED)};
  for(const m of measures){
    if(m.kind==='setpoint'){
      s.schedule.comfort=initialComfort-m.amount!;
      if(s.followProject)p.heater.setpoint_c=s.schedule.comfort;
    }
    if(m.kind==='eco')s.schedule.eco=m.amount!;
    if(m.kind==='shorten')for(const pattern of ['weekdays','weekends'] as const){
      const selected=s.schedule[pattern].flatMap((on,h)=>on?[h]:[]);
      s.schedule[pattern]=s.schedule[pattern].map((on,h)=>on&&h!==selected[0]&&h!==selected.at(-1));
    }
    if(m.kind==='tariff')s.active=m.target!;
    if(m.kind==='curtains'||m.kind==='film')modifiers.windowFactor*=assumptions[m.kind];
    if(m.kind==='draught')modifiers.achFactor*=assumptions.draught;
    if(m.kind==='dpe')p.dpe=m.target!;
    if(m.kind==='position'){
      const match=input.table&&matchPreset(input.project,input.table);
      const preset=match&&input.table!.presets[match.template][m.target!];
      if(!preset)throw Error('planner.unavailable');
      p.heater={...preset.heater,power_w:p.heater.power_w,setpoint_c:p.heater.setpoint_c};
    }
  }
  if(measures.some(m=>['curtains','film','draught'].includes(m.kind)))s.envelope=modifiers;
  let positionRatio=1;
  if(measures.some(m=>m.kind==='position')){
    const before={...p,heater:{...input.project.heater,power_w:p.heater.power_w,setpoint_c:p.heater.setpoint_c}};
    const a=predict(before,input.table!).field,b=predict(p,input.table!).field;
    if(!a||!b)throw Error('planner.unavailable');
    positionRatio=b.kpi.heat_loss_w/a.kpi.heat_loss_w;
  }
  const ua=input.calibratedUA*analyticUA(p,input.table,modifiers)/input.analytic.total*positionRatio;
  return {project:p,settings:s,ua};
}
export function simulateApplied(state:ReturnType<typeof applyMeasures>) {
  const {project:p,settings:s,ua}=state,profile=s.profiles.find(v=>v.id===s.active);
  if(!profile)throw Error('planner.unavailable');
  const consumption=simulateSeason({ua,area:p.room.length*p.room.width,ratedPower:p.heater.power_w,inertia:s.inertia,
    capacityPerArea:s.capacityPerArea??undefined,climate:s.climate,schedule:{...s.schedule,comfort:s.followProject?p.heater.setpoint_c:s.schedule.comfort}});
  return {...state,consumption,bill:evaluateTariff(consumption,profile,p.heater.power_w)};
}
type Scenario=ReturnType<typeof simulateApplied>;
function difference(baseline:Scenario,scenario:Scenario,emission:number,investment:Price) {
  const kwh=baseline.consumption.kwh-scenario.consumption.kwh;
  const euros=baseline.bill.total===null||scenario.bill.total===null?null:baseline.bill.total-scenario.bill.total;
  const a=baseline.consumption.comfortRate,b=scenario.consumption.comfortRate;
  return {kwh,euros,co2:kwh*emission,comfortPp:a===null||b===null?null:b-a,investment,
    payback:investment!==null&&euros!==null&&euros>0?investment/euros:null};
}
export function buildPlanner(input:PlannerInput,preferences:PlannerPreferences) {
  const {assumptions,costs}=preferences;
  const baseline=simulateApplied(applyMeasures(input,[],assumptions));
  const candidates=measuresFor(input).map(measure=>{
    // A tariff-only comparison reuses the baseline hourly consumption.
    const state=applyMeasures(input,[measure],assumptions);
    const scenario=measure.kind==='tariff'?{...state,consumption:baseline.consumption,
      bill:evaluateTariff(baseline.consumption,state.settings.profiles.find(p=>p.id===state.settings.active)!,state.project.heater.power_w)}:simulateApplied(state);
    return {measure,scenario,apply:()=>structuredClone(state),
      explanation:{zh:translate('planner.explain.'+measure.kind,'zh'),en:translate('planner.explain.'+measure.kind,'en')},
      ...difference(baseline,scenario,assumptions.emission,costs[measure.id]??null)};
  });
  const ranking=baseline.bill.total===null?'kwh':'euros';
  candidates.sort((a,b)=>(b[ranking]??-Infinity)-(a[ranking]??-Infinity)||b.kwh-a.kwh||a.measure.id.localeCompare(b.measure.id));
  return {baseline,candidates,ranking,positionTip:!candidates.some(c=>c.measure.kind==='position')};
}
export function combinedPlan(input:PlannerInput,selected:Measure[],preferences:PlannerPreferences) {
  const baseline=simulateApplied(applyMeasures(input,[],preferences.assumptions));
  const scenario=simulateApplied(applyMeasures(input,selected,preferences.assumptions));
  const values=selected.map(m=>preferences.costs[m.id]??null);
  const investment=selected.length&&values.every(v=>v!==null)?values.reduce<number>((sum,v)=>sum+v!,0):null;
  return {scenario,...difference(baseline,scenario,preferences.assumptions.emission,investment)};
}
