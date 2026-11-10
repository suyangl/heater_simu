import {Language,translate,translateWarning} from './i18n';
export type Runtime = {elapsed_s:number;estimated_total_s?:number;budget_s?:number};
export function duration(seconds:number|undefined,language:Language='zh'):string {
  if(seconds===undefined||!Number.isFinite(seconds))return '—';
  const s=Math.max(0,Math.floor(seconds));
  return translate('duration',language,{minutes:Math.floor(s/60),seconds:s%60});
}
export function progressText(runtime:Runtime|null,language:Language='zh'):string {
  if(!runtime)return '';
  return translate('progress',language,{elapsed:duration(runtime.elapsed_s,language),estimate:duration(runtime.estimated_total_s,language),budget:duration(runtime.budget_s,language),overrun:runtime.estimated_total_s!==undefined&&runtime.elapsed_s>runtime.estimated_total_s?translate('overrun',language):''});
}
export function settlementWarning(result:{kpi?:{not_settled?:boolean;settlement_warning?:string}},language:Language='zh'):string {
  const warning=result.kpi?.not_settled?(result.kpi.settlement_warning||translate('结果尚未稳定，不能视为已收敛；请增加求解预算后重算。','zh')):'';
  return language==='zh'?warning:translateWarning(warning,language);
}
export function capacityText(insufficientPower:boolean,warning:string,language:Language='zh'):string {
  return translate(warning?'尚未确认':insufficientPower?'功率不足':'功率充足',language);
}
