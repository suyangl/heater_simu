import {describe,expect,it} from 'vitest';
import fixture from './hybrid-fixture.json';
import modelJson from '../public/surrogate/hybrid-v1.json';
import s1Json from '../public/surrogate/s1-v1.json';
import {HybridModel,hybridContext,hybridFeatures,intersects,predictHybrid,regress,validHybrid} from './hybrid';
import {Project,Table,predict,ua} from './s1';
import {decode} from './ResultLayers';
import {makeSampler} from './probe';
import {deriveS1Surfaces} from './s1Surfaces';

const model=modelJson as unknown as HybridModel,table=s1Json as unknown as Table;
const project=()=>structuredClone(fixture.samples[0].project) as Project;
describe('hybrid browser predictor',()=>{
  it('matches Python geometry, features, theta, k and UA within 1e-6',()=>{
    expect(fixture.model.field).toEqual(model.field);
    expect(fixture.model.power).toEqual(model.power);
    for(const sample of fixture.samples){
      const p=sample.project as Project,vector=hybridFeatures(p,sample.point),c=hybridContext(p).c;
      vector.forEach((v,i)=>expect(Math.abs(v-sample.features[i])).toBeLessThan(1e-6));
      c.forEach((v,i)=>expect(Math.abs(v-sample.case_features[i])).toBeLessThan(1e-6));
      expect(Math.abs(1+regress(fixture.model.field,vector)-sample.theta)).toBeLessThan(1e-6);
      expect(Math.abs(Math.exp(regress(fixture.model.power,c))-sample.k)).toBeLessThan(1e-6);
      expect(Math.abs(ua(p,table)-sample.ua)).toBeLessThan(1e-6);
    }
  });
  it('returns the existing slice, probe, surface and KPI contract with solid masks',()=>{
    const p=project(),field=predictHybrid(p,model)!;
    expect(field.source).toBe('hybrid');expect(field.grid.nx*field.grid.ny*field.grid.nz).toBe(5760);
    const values=decode(field.T.data);
    expect(values.length).toBe(5760);expect(Array.from(values).some(Number.isNaN)).toBe(true);
    const sampler=makeSampler(field,p.furniture);
    expect(sampler(p.room.length/2,p.room.width/2,1.2).value).not.toBeNull();
    expect(deriveS1Surfaces(p,field).length).toBeGreaterThan(0);
    expect(field.T.min).toBeLessThan(field.T.max);
    expect(field.kpi.heat_loss_w).toBe(field.kpi.cfd_heater_power_w);
    const baseline=field.kpi.heat_loss_w,rise=p.heater.setpoint_c-p.outdoor_temp;
    p.outdoor_temp-=10;
    expect(predictHybrid(p,model)!.kpi.heat_loss_w/baseline).toBeCloseTo((rise+10)/rise);
    p.heater.power_w=1;
    expect(predictHybrid(p,model)!.kpi.insufficient_power).toBe(true);
    expect(predictHybrid(p,model)!.kpi.cfd_heater_power_w).toBeGreaterThan(1);
  });
  it('predicts custom multi-wall, furnished and windowless projects but retains S1 priority',()=>{
    const p=project();p.room.length+=.2;
    const prediction=predict(p,table,'en',model);
    expect(prediction.field?.source).toBe('hybrid');expect(prediction.confidence).toBe('Low');
    expect(prediction.reason).toContain('not CFD');expect(prediction.reason).toContain('Docker');
    expect(predict(p,table,'zh',model).reason).toContain('自定义');
    expect(predict(project(),table,'en',model).field?.source).toBe('s1');
    for(const sample of fixture.samples)expect(predictHybrid(sample.project as Project,model)).not.toBeNull();
    expect(predict(p,table).field).toBeNull();
  });
  it('handles nonheating inputs, invalid artifacts and an empty air mask',()=>{
    const p=project();p.outdoor_temp=30;
    expect(predictHybrid(p,model)).toBeNull();expect(predict(p,table,'en',model).field).toBeNull();
    expect(validHybrid(null)).toBe(false);expect(validHybrid({version:'hybrid-v1'})).toBe(false);
    const bad=structuredClone(model);bad.field.std[0]=0;
    expect(predictHybrid(project(),bad)).toBeNull();
    const full=project();full.furniture=[{x:0,y:0,z:0,l:full.room.length,w:full.room.width,h:full.room.height}];
    expect(predictHybrid(full,model)).toBeNull();
  });
  it('handles parallel and intersecting furniture sight lines',()=>{
    const box={x:1,y:1,z:0,l:1,w:1,h:1};
    expect(intersects([0,1.5,.5],[3,1.5,.5],box)).toBe(true);
    expect(intersects([0,0,.5],[3,0,.5],box)).toBe(false);
  });
});
