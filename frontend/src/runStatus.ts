export type Runtime = {elapsed_s:number;estimated_total_s?:number;budget_s?:number};

export function duration(seconds:number|undefined):string {
  if(seconds===undefined||!Number.isFinite(seconds))return '—';
  const s=Math.max(0,Math.floor(seconds));
  return `${Math.floor(s/60)} 分 ${s%60} 秒`;
}

export function progressText(runtime:Runtime|null):string {
  if(!runtime)return '';
  return `已用 ${duration(runtime.elapsed_s)} · 初始预计约 ${duration(runtime.estimated_total_s)} · 求解预算 ${duration(runtime.budget_s)}${runtime.estimated_total_s!==undefined&&runtime.elapsed_s>runtime.estimated_total_s?'（已超过初始估计）':''}`;
}

export function settlementWarning(result:{kpi?:{not_settled?:boolean;settlement_warning?:string}}):string {
  return result.kpi?.not_settled?(result.kpi.settlement_warning||'结果尚未稳定，不能视为已收敛；请增加求解预算后重算。'):'';
}

export function capacityText(insufficientPower:boolean,warning:string):string {
  return warning?'尚未确认':insufficientPower?'功率不足':'功率充足';
}
