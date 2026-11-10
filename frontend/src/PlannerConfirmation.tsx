import React from 'react';
import {Assumptions,Measure,PlannerInput} from './planner';
import {BillingSettings} from './billing';
import {Language,translate} from './i18n';

type Totals={kwh:number;euros:number|null};
type Season={consumption:{kwh:number};bill:{total:number|null}};
export type Confirmation={titles:Record<Language,string[]>;before:Totals;after:Totals;inputKey:string};
export const plannerInputKey=(input:Pick<PlannerInput,'project'|'settings'>)=>JSON.stringify({project:input.project,settings:input.settings});
const totals=(season:Season):Totals=>({kwh:season.consumption.kwh,euros:season.bill.total});
export function measureTitle(m:Measure,input:PlannerInput,language:Language) {
  const t=(key:string,params?:Record<string,string|number|undefined>)=>translate(key,language,params);
  const profile=input.settings.profiles.find(p=>p.id===m.target);
  const target=m.kind==='tariff'?profile?.name||t('billing.unnamed',{n:input.settings.profiles.findIndex(p=>p.id===m.target)+1}):
    m.kind==='position'?t(({under_window:'窗下',beside_window:'外墙窗旁',opposite_wall:'对面内墙',interior_corner:'内墙角落'} as Record<string,string>)[m.target!]??m.target!):m.target;
  return t('planner.measure.'+m.kind,{n:m.amount,target});
}
export function appliedConfirmation(measures:Measure[],input:PlannerInput,before:Season,after:Season,
  state:Pick<PlannerInput,'project'|'settings'>):Confirmation {
  return {titles:{zh:measures.map(m=>measureTitle(m,input,'zh')),en:measures.map(m=>measureTitle(m,input,'en'))},
    before:totals(before),after:totals(after),inputKey:plannerInputKey(state)};
}
export function refreshConfirmation(current:Confirmation|null,inputKey:string,baseline:Season):Confirmation|null {
  if(!current||current.inputKey!==inputKey)return current;
  const after=totals(baseline);
  return current.after.kwh===after.kwh&&current.after.euros===after.euros?current:{...current,after};
}
export function PlannerConfirmation({confirmation,language}:{confirmation:Confirmation;language:Language}) {
  const t=(key:string,params?:Record<string,string>)=>translate(key,language,params);
  const fmt=(value:number|null,digits:number)=>value===null||!Number.isFinite(value)?'—':
    new Intl.NumberFormat(language==='zh'?'zh-CN':'en-GB',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value);
  return <div className="planner-applied" role="status">
    <strong>{t('planner.appliedDetail',{measures:confirmation.titles[language].join(language==='zh'?'、':', ')})}</strong>
    <p>{t('planner.appliedTotals',{beforeKwh:fmt(confirmation.before.kwh,1),afterKwh:fmt(confirmation.after.kwh,1),
      beforeEuro:fmt(confirmation.before.euros,2),afterEuro:fmt(confirmation.after.euros,2)})}</p>
    <small>{t('planner.applied')}</small>
  </div>;
}
type Envelope=BillingSettings['envelope'];
export function activeRetrofits(envelope:Envelope,assumptions:Assumptions) {
  const active:{key:'windowFactor'|'achFactor';title:string;factor:number;unit:string}[]=[];
  if(envelope&&envelope.windowFactor!==1){
    const curtains=envelope.windowFactor===assumptions.curtains,film=envelope.windowFactor===assumptions.film;
    active.push({key:'windowFactor',title:curtains&&!film?'planner.measure.curtains':film&&!curtains?'planner.measure.film':'planner.windowTreatment',
      factor:envelope.windowFactor,unit:'planner.windowFactor'});
  }
  if(envelope&&envelope.achFactor!==1)active.push({key:'achFactor',title:'planner.measure.draught',factor:envelope.achFactor,unit:'planner.achFactor'});
  return active;
}
export function removeRetrofit(envelope:Envelope,key:'windowFactor'|'achFactor'):Envelope {
  const next={windowFactor:1,achFactor:1,...envelope,[key]:1};
  return next.windowFactor===1&&next.achFactor===1?undefined:next;
}
