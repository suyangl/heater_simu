import {describe,it,expect} from 'vitest';
import {deriveS1Surfaces} from './s1Surfaces';
import {decode} from './ResultLayers';
import {Project} from './s1';
import {TemperatureField} from './probe';

const project:Project={room:{length:4,width:3,height:2.5},exterior_wall:'N',window:{offset:1,width:1,height:1,sill:1},
  dpe:'C',outdoor_temp:5,heater:{power_w:1500,setpoint_c:19,wall:'N',offset:1,z:.15,length:.8,depth:.1,height:.5},
  furniture:[{x:1,y:1,z:0,l:1,w:1,h:.5}]};
function field(values:number[]):TemperatureField {
  return {grid:{nx:2,ny:2,nz:2,origin:[.1,.1,.1],spacing:[3.8,2.8,2.3]},T:{data:btoa(String.fromCharCode(...new Uint8Array(new Float32Array(values).buffer)))}};
}
describe('approximate S1 surfaces',()=>{
  it('builds six room faces, every furniture box and the heater with valid indexed triangles',()=>{
    const surfaces=deriveS1Surfaces(project,field([18,19,20,21,22,23,24,25]));
    expect(surfaces.map(s=>s.name).sort()).toEqual(['E','N','S','W','ceiling','floor','furniture-0','heater'].sort());
    for(const s of surfaces){
      const xyz=decode(s.positions),values=decode(s.T),indices=decode(s.indices,true);
      expect(values.length).toBe(xyz.length/3);
      expect(indices.length%3).toBe(0);
      expect([...indices].every(i=>i<values.length)).toBe(true);
      expect([...values].every(t=>t>=18&&t<=25)).toBe(true);
    }
  });
  it('samples the displayed field, including nearest-valid fallback, rather than inventing wall temperatures',()=>{
    const cold=deriveS1Surfaces(project,field([NaN,10,10,10,10,10,10,10]));
    const warm=deriveS1Surfaces(project,field([NaN,30,30,30,30,30,30,30]));
    expect(cold.length).toBe(8);
    expect(cold.every(s=>[...decode(s.T)].every(t=>t===10))).toBe(true);
    expect(warm.every(s=>[...decode(s.T)].every(t=>t===30))).toBe(true);
  });
  it('handles empty, masked and malformed fields without rendering invalid triangles',()=>{
    expect(deriveS1Surfaces(project,null)).toEqual([]);
    expect(deriveS1Surfaces(project,field(Array(8).fill(NaN)))).toEqual([]);
    expect(deriveS1Surfaces(project,{...field([]),T:{data:'bad'}})).toEqual([]);
    expect(deriveS1Surfaces({...project,furniture:[]},field(Array(8).fill(19))).length).toBe(7);
  });
});
