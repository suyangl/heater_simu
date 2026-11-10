import {en,zh} from './messages';
export type Language='zh'|'en';
export const dictionaries={zh,en};
export type Params=Record<string,string|number|undefined>;
const reverse=new Map(Object.entries(en).map(([key,value])=>[value,key]));
export function translate(key:string,language:Language='zh',params:Params={}):string {
  const canonical=Object.hasOwn(en,key)?key:reverse.get(key)??key;
  const text=(dictionaries[language] as Record<string,string>)[canonical]??key;
  return text.replace(/\{(\w+)\}/g,(_,name)=>String(params[name]??'{'+name+'}'));
}
export function initialLanguage(stored:string|null,browser:string):Language {
  return stored==='zh'||stored==='en'?stored:browser.toLowerCase().startsWith('zh')?'zh':'en';
}
export class ApiError extends Error {
  constructor(public detail:unknown){super('API request failed');}
}
export function translateWarning(warning:string,language:Language):string {
  if(!warning)return '';
  const key=warning.includes('求解预算已耗尽')?'求解预算已耗尽':warning.includes('测量块上限')?'测量块上限':'结果尚未稳定，不能视为已收敛；请增加求解预算后重算。';
  return translate(key,language)+(warning.includes('尚无完整平均温度场')?' '+translate('尚无完整平均温度场',language):'');
}
export function formatError(error:unknown,language:Language):string {
  if(error instanceof ApiError)return formatError(error.detail,language);
  if(Array.isArray(error))return error.map(e=>formatError(e,language)).join('; ');
  if(error&&typeof error==='object'&&'msg' in error){
    const e=error as {msg:string;type:string;ctx?:Record<string,number>;loc?:Array<string|number>};
    const types:Record<string,[string,string?]>={missing:['必填字段'],literal_error:['请选择有效选项'],finite_number:['请输入有限数字'],float_parsing:['请输入有限数字'],extra_forbidden:['不允许额外字段'],greater_than_equal:['至少 {bound}','ge'],greater_than:['大于 {bound}','gt'],less_than_equal:['至多 {bound}','le'],less_than:['小于 {bound}','lt'],too_long:['最多 {bound} 项','max_length'],string_too_long:['最多 {bound} 项','max_length']};
    const rule=types[e.type];const message=rule?translate(rule[0],language,{bound:e.ctx?.[rule[1]??'']}):formatError(e.msg,language);
    return (e.loc?.filter(x=>x!=='body').join('.')||'')+': '+message;
  }
  const text=(error instanceof Error?error.message:String(error??'')).replace(/^Value error, /,'');
  return Object.hasOwn(en,text)||reverse.has(text)?translate(text,language):translate('请求失败，请检查输入或查看求解日志',language);
}
