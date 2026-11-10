import {describe,expect,it} from 'vitest';
import {duration,progressText,settlementWarning} from './runStatus';

describe('interactive status',()=>{
  it('formats live elapsed, estimated time and solver budget',()=>{
    expect(progressText({elapsed_s:125,estimated_total_s:1800,budget_s:2700})).toBe('已用 2 分 5 秒 · 初始预计约 30 分 0 秒 · 求解预算 45 分 0 秒');
    expect(progressText({elapsed_s:1801,estimated_total_s:1800})).toContain('已超过初始估计');
  });
  it('handles queued, legacy and missing timings',()=>{
    expect(progressText(null)).toBe('');
    expect(duration(undefined)).toBe('—');
    expect(duration(NaN)).toBe('—');
    expect(duration(-1)).toBe('0 分 0 秒');
    expect(settlementWarning({})).toBe('');
    expect(settlementWarning({kpi:{not_settled:false}})).toBe('');
  });
  it('warns for budget-limited results, including missing-field results',()=>{
    expect(settlementWarning({kpi:{not_settled:true,settlement_warning:'尚无完整平均温度场'}})).toBe('尚无完整平均温度场');
    expect(settlementWarning({kpi:{not_settled:true}})).toContain('不能视为已收敛');
  });
});
