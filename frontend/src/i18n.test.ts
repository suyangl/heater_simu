import {describe,expect,it} from 'vitest';
import {ApiError,dictionaries,formatError,initialLanguage,translate,translateWarning} from './i18n';
import {kindLabel,migrateKind,migrateProject} from './furniture';
import {capacityText,progressText} from './runStatus';
import type {Project} from './s1';

describe('bilingual UI',()=>{
  it('has identical dictionary keys and matching interpolation parameters',()=>{
    expect(Object.keys(dictionaries.zh).sort()).toEqual(Object.keys(dictionaries.en).sort());
    for(const key of Object.keys(dictionaries.en) as Array<keyof typeof dictionaries.en>){
      expect(dictionaries.en[key].trim()).not.toBe('');
      expect(dictionaries.zh[key].match(/\{\w+\}/g)?.sort()).toEqual(dictionaries.en[key].match(/\{\w+\}/g)?.sort());
      expect(key+dictionaries.zh[key]+dictionaries.en[key]).not.toContain('\uFFFD');
      if(key!=='中文')expect(dictionaries.en[key]).not.toMatch(/\p{Script=Han}/u);
    }
  });
  it('follows the browser unless a valid persisted choice exists',()=>{
    expect(initialLanguage(null,'zh-TW')).toBe('zh');
    expect(initialLanguage(null,'fr-FR')).toBe('en');
    expect(initialLanguage('en','zh-CN')).toBe('en');
    expect(initialLanguage('zh','en-US')).toBe('zh');
    expect(initialLanguage('invalid','en')).toBe('en');
  });
  it('migrates old Chinese furniture kinds without changing geometry or names',()=>{
    for(const [key,old] of Object.entries(kindLabel)){
      expect(migrateKind(old)).toBe(key);expect(migrateKind(key)).toBe(key);
    }
    expect(migrateKind()).toBe('custom');expect(migrateKind('unknown')).toBe('custom');
    const p={furniture:[{kind:'床',name:'我的床',x:1,y:2,z:0,l:1.9,w:1.4,h:.55}]} as Project;
    expect(migrateProject(p).furniture).toEqual([{...p.furniture[0],kind:'bed'}]);
    expect(p.furniture[0].kind).toBe('床');
    expect(migrateProject({...p,furniture:[]})).toEqual({...p,furniture:[]});
  });
  it('translates 422 geometry errors, Pydantic bounds and unknown errors',()=>{
    expect(formatError(new ApiError('家具或暖器重叠'),'en')).toBe('Furniture or heater overlaps');
    expect(formatError(new ApiError([{loc:['body','room','length'],type:'greater_than_equal',msg:'Input should be greater than or equal to 2',ctx:{ge:2}}]),'en')).toContain('at least 2');
    expect(formatError(new ApiError('未知错误'),'en')).toContain('Request failed');
    expect(formatError(new ApiError([]),'zh')).toContain('请求失败');
    expect(formatError('家具或暖器超出房间','en')).toBe('Furniture or heater extends beyond the room');
    expect(formatError('Value error, 窗户只能位于外墙','en')).toBe('Windows must be on exterior walls');
  });
  it('translates timing, unsettled warnings and capacity on a language switch',()=>{
    expect(progressText({elapsed_s:1900,estimated_total_s:1800,budget_s:2700},'en')).toContain('initial estimate exceeded');
    expect(translateWarning('求解预算已耗尽，尚无完整平均温度场','en')).toContain('No complete averaged temperature field');
    expect(capacityText(false,'not settled','en')).toBe('Unconfirmed');
    expect(capacityText(false,'','en')).toBe('Sufficient power');
    expect(translate(translate('模拟完成','en'),'zh')).toBe('模拟完成');
  });
});
