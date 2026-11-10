import {describe,it,expect,vi} from 'vitest';
import artifact from '../public/surrogate/s1-v1.json';
import indexJson from '../public/cfd-examples/index.json';
import {Table,predict} from './s1';
import {CFDIndex,chooseCFDExample,combineExample,createExampleLoader,ExampleResult} from './cfdExamples';

const table=artifact as unknown as Table,index=indexJson as unknown as CFDIndex;
const entry=index.cases.find(e=>e.id==='train-bedroom_small-A-under_window')!;
const p=entry.project;
const s1={...predict(p,table).field!,kpi:{...predict(p,table).field!.kpi,energy_balance_error:0},surfaces:[]} as ExampleResult;
const real={...s1,source:'openfoam',U:{data:'',min:0,max:.2},streamlines:{positions:'',indices:'',offsets:'',T:'',speed:'',line_count:2},isosurface:{positions:'',indices:'',T:'',speed:'',level_c:19}} as ExampleResult;
describe('bundled CFD selection',()=>{
  it('matches all physics inputs and geometry, ignoring cosmetic furniture labels',()=>{
    expect(chooseCFDExample(p,table,index)).toEqual({entry,exact:true});
    const named={...p,furniture:p.furniture.map(b=>({...b,name:'bed',kind:'bed'}))};
    expect(chooseCFDExample(named,table,index)?.exact).toBe(true);
    for(const changed of [{...p,outdoor_temp:6},{...p,heater:{...p.heater,setpoint_c:20}},{...p,heater:{...p.heater,power_w:1500}},
      {...p,room:{...p.room,length:p.room.length+.01}}])
      expect(chooseCFDExample(changed,table,index)?.exact).toBe(false);
  });
  it('selects exact DPE first, otherwise nearest grade, always with the same heater position',()=>{
    expect(chooseCFDExample({...p,dpe:'C'},table,index)?.entry.dpe).toBe('C');
    const nearest=chooseCFDExample({...p,dpe:'F'},table,index)!;
    expect(['E','G']).toContain(nearest.entry.dpe);expect(nearest.exact).toBe(false);
    const opposite=index.cases.find(e=>e.template==='bedroom_small'&&e.position==='opposite_wall')!;
    expect(chooseCFDExample(opposite.project,table,index)?.entry.position).toBe('opposite_wall');
  });
  it('handles no-case templates, non-template geometry and empty indexes',()=>{
    expect(chooseCFDExample(table.presets.living.under_window,table,index)).toBeNull();
    expect(chooseCFDExample({...p,room:{...p.room,length:9}},table,index)).toBeNull();
    expect(chooseCFDExample(p,table,{version:1,cases:[]})).toBeNull();
  });
  it('displays exact CFD unchanged, but overlays only flow data onto non-exact S1',()=>{
    const choice={entry,exact:true};
    expect(combineExample(s1,choice,real)).toBe(real);
    const overlay=combineExample(s1,{...choice,exact:false},real)!;
    expect(overlay.T).toBe(s1.T);expect(overlay.surfaces).toBe(s1.surfaces);expect(overlay.kpi).toBe(s1.kpi);
    expect(overlay.streamlines).toBe(real.streamlines);expect(overlay.isosurface).toBe(real.isosurface);expect(overlay.U).toBe(real.U);
    expect(combineExample(s1,choice,null)).toBe(s1);
    expect(combineExample(null,{...choice,exact:false},real)).toBeNull();
  });
});
describe('CFD example loading',()=>{
  it('loads only the index initially and lazily caches the selected static file, without API calls',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify(index))).mockResolvedValueOnce(new Response(JSON.stringify(real)));
    const loader=createExampleLoader(fetcher);await loader.loadIndex();
    expect(fetcher.mock.calls.map(c=>c[0])).toEqual(['/cfd-examples/index.json']);
    const results=await Promise.all([loader.loadCase(entry),loader.loadCase(entry)]);
    expect(results[0]).toBe(results[1]);
    expect(fetcher.mock.calls.map(c=>c[0])).toEqual(['/cfd-examples/index.json','/cfd-examples/'+entry.id+'.json']);
  });
  it('rejects missing/corrupt files and unsafe ids without poisoning the case cache',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('',{status:404}))
      .mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response(JSON.stringify(real)));
    const loader=createExampleLoader(fetcher);
    await expect(loader.loadCase(entry)).rejects.toThrow('unavailable');
    await expect(loader.loadCase(entry)).rejects.toThrow('Invalid');
    await expect(loader.loadCase(entry)).resolves.toMatchObject({source:'openfoam'});
    await expect(loader.loadCase({...entry,id:'../api/jobs'})).rejects.toThrow('Invalid');
    await expect(createExampleLoader(vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'))).loadIndex()).rejects.toThrow('Invalid');
  });
});
