import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {appliedConfirmation,refreshConfirmation,plannerInputKey,PlannerConfirmation,activeRetrofits,removeRetrofit} from './PlannerConfirmation';
import {DEFAULT_ASSUMPTIONS,PlannerInput,Measure} from './planner';
import {restoreSettings} from './billing';
import artifact from '../public/surrogate/s1-v1.json';
import {Project} from './s1';
import {translate} from './i18n';

const project=artifact.presets.bedroom_small.under_window as Project;
const input={project,settings:restoreSettings(null,19)} as PlannerInput;
const measures:Measure[]=[{id:'setpoint-2',category:'setpoint',group:'setpoint',kind:'setpoint',amount:2},
  {id:'curtains',category:'retrofit',group:'window',kind:'curtains'}];
const before={consumption:{kwh:683.3},bill:{total:180}},after={consumption:{kwh:551.7},bill:{total:153.68}};
describe('applied planner confirmation',()=>{
  it('keeps applied titles and before/after seasonal totals independently of cleared selections or re-ranking',()=>{
    const confirmation=appliedConfirmation(measures,input,before,after,input);
    expect(confirmation.titles.en).toEqual(['Comfort −2 °C','Heavy curtains']);
    expect(confirmation.titles.zh).toEqual(['舒适设定 −2 °C','厚窗帘']);
    measures[0].amount=1;
    expect(confirmation.titles.en[0]).toBe('Comfort −2 °C');measures[0].amount=2;
    for(const language of ['en','zh'] as const){
      const html=renderToStaticMarkup(<PlannerConfirmation confirmation={confirmation} language={language}/>);
      expect(html).toContain(language==='zh'?'已应用：':'Applied:');
      expect(html).toContain('683.3 → 551.7 kWh');
      expect(html).toContain('180.00 → 153.68 €');
      expect(html).toContain(language==='zh'?'厚窗帘':'Heavy curtains');
    }
  });
  it('confirms a single row and leaves unavailable euro totals as dashes, not zeros',()=>{
    const confirmation=appliedConfirmation([measures[1]],input,{...before,bill:{total:null}},{...after,bill:{total:null}},input);
    const html=renderToStaticMarkup(<PlannerConfirmation confirmation={confirmation} language="en"/>);
    expect(html).toContain('Applied: Heavy curtains');expect(html).toContain('— → — €');
    expect(translate('planner.compareHint','en')).toBe('Ticking only compares; click “Apply selected plan” to change the project');
    expect(translate('planner.compareHint','zh')).toBe('勾选只做比较；点“应用所选计划”才会修改项目');
  });
  it('refreshes the actual recalibrated post-apply baseline only for the applied project/settings',()=>{
    const confirmation=appliedConfirmation(measures,input,before,after,input);
    const updated=refreshConfirmation(confirmation,plannerInputKey(input),{...after,consumption:{kwh:560}});
    expect(updated!.after.kwh).toBe(560);expect(updated!.before.kwh).toBe(683.3);
    expect(refreshConfirmation(confirmation,'unrelated edit',after)).toBeNull();
    expect(refreshConfirmation(null,plannerInputKey(input),after)).toBeNull();
  });
  it('clears applied savings after individual retrofit removal, resetting all retrofits, or undoing project/settings changes',()=>{
    const state={project:{...project,heater:{...project.heater,setpoint_c:17}},
      settings:{...input.settings,envelope:{windowFactor:.85,achFactor:.8}}};
    const confirmation=appliedConfirmation(measures,input,before,after,state);
    expect(refreshConfirmation(confirmation,plannerInputKey(state),after)).toBe(confirmation);
    const changes=[
      {...state,settings:{...state.settings,envelope:removeRetrofit(state.settings.envelope,'windowFactor')}},
      {...state,settings:{...state.settings,envelope:removeRetrofit(state.settings.envelope,'achFactor')}},
      {...state,settings:{...state.settings,envelope:undefined}},
      {...state,project},
      {...state,settings:{...state.settings,schedule:{...state.settings.schedule,comfort:20}}}
    ];
    for(const changed of changes){
      expect(refreshConfirmation(confirmation,plannerInputKey(changed),after)).toBeNull();
      expect(refreshConfirmation(confirmation,plannerInputKey(changed))).toBeNull();
    }
    expect(refreshConfirmation(confirmation,plannerInputKey(state))).toBe(confirmation);
  });
});
describe('visible applied retrofits',()=>{
  it('identifies curtains, film, custom window treatment and draught factors without inventing identities',()=>{
    expect(activeRetrofits({windowFactor:.85,achFactor:.8},DEFAULT_ASSUMPTIONS).map(m=>m.title)).toEqual(['planner.measure.curtains','planner.measure.draught']);
    expect(activeRetrofits({windowFactor:.9,achFactor:1},DEFAULT_ASSUMPTIONS)[0].title).toBe('planner.measure.film');
    expect(activeRetrofits({windowFactor:.7,achFactor:1},DEFAULT_ASSUMPTIONS)[0].title).toBe('planner.windowTreatment');
    expect(activeRetrofits(undefined,DEFAULT_ASSUMPTIONS)).toEqual([]);
    expect(activeRetrofits({windowFactor:1,achFactor:1},DEFAULT_ASSUMPTIONS)).toEqual([]);
  });
  it('removes one modifier without changing another, then clears the empty modifier state',()=>{
    const envelope={windowFactor:.85,achFactor:.8};
    expect(removeRetrofit(envelope,'windowFactor')).toEqual({windowFactor:1,achFactor:.8});
    expect(envelope.windowFactor).toBe(.85);
    expect(removeRetrofit(removeRetrofit(envelope,'windowFactor'),'achFactor')).toBeUndefined();
    expect(removeRetrofit(undefined,'windowFactor')).toBeUndefined();
  });
});
