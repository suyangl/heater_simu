import {describe,it,expect} from 'vitest';
import tableJson from '../public/surrogate/s1-v1.json';
import {chooseStaticTemplate,restoreStaticProject,staticProjectTemplate} from './staticProject';
import {predict,Table} from './s1';

const table=tableJson as unknown as Table;
describe('static visitor project',()=>{
  it('starts from the best-covered preset with an immediately usable field',()=>{
    const selected=chooseStaticTemplate(table)!;
    expect([selected.template,selected.position]).toEqual(['bedroom_small','under_window']);
    expect(selected.project.room).toEqual({length:3.5,width:3,height:2.5});
    expect(predict(selected.project,table).field).not.toBeNull();
    expect(staticProjectTemplate(selected.project,table).template).toBe('bedroom_small');
    expect(table.presets.bedroom_small.under_window.furniture[0].kind).toBeUndefined();
  });
  it('keeps a restored non-template project instead of silently replacing it',()=>{
    const custom=structuredClone(chooseStaticTemplate(table)!.project);custom.room.length=3.6;
    const restored=restoreStaticProject(JSON.stringify({version:1,project:custom}));
    expect(restored).toEqual(custom);
    expect(staticProjectTemplate(restored!,table).template).toBe('');
    expect(predict(restored!,table).field).toBeNull();
    expect(predict(chooseStaticTemplate(table)!.project,table).field).not.toBeNull();
  });
  it('handles empty tables and absent, corrupt, unsupported or incomplete saved data',()=>{
    expect(chooseStaticTemplate({...table,cases:[]})).toBeNull();
    for(const raw of [null,'bad','null','{}','{"version":2}','{"version":1,"project":{}}'])
      expect(restoreStaticProject(raw)).toBeNull();
  });
});
