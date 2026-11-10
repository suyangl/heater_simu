import {describe,it,expect} from 'vitest';
import {CAPACITY,Consumption,Schedule,assignTempo,calibratedUA,compareTariffs,defaultClimate,defaultSchedule,evaluateTariff,isOffPeak,newProfile,outdoorTemperature,rateAt,restoreSettings,simulateSeason,validPeriods} from './billing';
const input=()=>({ua:40,area:20,ratedPower:2000,inertia:'medium' as const,
  climate:{months:defaultClimate().months.map(m=>({...m,mean:5})),amplitude:0},
  schedule:{...defaultSchedule(20),eco:20,weekdays:Array(24).fill(true),weekends:Array(24).fill(true)}});
const base=()=>({...newProfile('base','Base'),base:.2,subscription:10,kva:6});
function shortened(schedule:Schedule):Schedule {
  const result=structuredClone(schedule);
  for(const pattern of ['weekdays','weekends'] as const){
    const selected=result[pattern].flatMap((on,h)=>on?[h]:[]);
    result[pattern]=result[pattern].map((on,h)=>on&&h!==selected[0]&&h!==selected.at(-1));
  }
  return result;
}
function scheduleInput(ua=5.916297293170128,comfort=18){
  return {ua,area:10.5,ratedPower:1500,inertia:'medium' as const,climate:defaultClimate(),schedule:defaultSchedule(comfort)};
}
function hpHcBreakdown(consumption:Consumption){
  return consumption.hours.reduce((periods,h)=>{
    // Independent explicit classification for the fixed 22:00–06:00 test tariff.
    const period=h.hour>=22||h.hour<6?'hc':'hp';
    periods[period].kwh+=h.kwh;periods[period].euros+=h.kwh*(period==='hc'?.12:.25);
    return periods;
  },{hp:{kwh:0,euros:0},hc:{kwh:0,euros:0}});
}
describe('fair RC schedule comparisons',()=>{
  it('does not give lower eco settings a colder initial thermal store (DPE A 19°C and C 18°C regressions)',()=>{
    for(const [ua,comfort,eco] of [[3.674783042328619,19,14],[5.916297293170128,18,15]]){
      const i=scheduleInput(ua,comfort),baseline=simulateSeason(i);
      const lower=simulateSeason({...i,schedule:{...i.schedule,eco}});
      const expectedFirst=comfort+(baseline.hours[0].outdoor-comfort)*(-Math.expm1(-ua*3600/(CAPACITY.medium*10.5)));
      expect(baseline.hours[0].indoor).toBeCloseTo(expectedFirst,10);
      expect(lower.hours[0].indoor).toBeCloseTo(expectedFirst,10);
      expect(lower.kwh).toBeLessThanOrEqual(baseline.kwh+1e-8);
      expect(lower.hours.every((h,n)=>h.indoor<=baseline.hours[n].indoor+1e-8)).toBe(true);
    }
  });
  it('lowering eco never increases kWh across inertias and UA, including rated-power clipping',()=>{
    for(const inertia of ['light','medium','heavy'] as const)for(const ua of [.5,3.674783042328619,5.916297293170128,40,200]){
      const i={...scheduleInput(ua),inertia},baseline=simulateSeason(i);
      for(const eco of [15,14]){
        const lower=simulateSeason({...i,schedule:{...i.schedule,eco}});
        expect(lower.kwh).toBeLessThanOrEqual(baseline.kwh+1e-8);
        expect(lower.hours.every((h,n)=>h.indoor<=baseline.hours[n].indoor+1e-8)).toBe(true);
      }
    }
  });
  it('shortening comfort hours cannot increase kWh or Base cost',()=>{
    for(const ua of [3.674783042328619,5.916297293170128,40]){
      const i=scheduleInput(ua),baseline=simulateSeason(i),short=simulateSeason({...i,schedule:shortened(i.schedule)});
      const b=evaluateTariff(baseline,base(),1500),s=evaluateTariff(short,base(),1500);
      expect(short.kwh).toBeLessThanOrEqual(baseline.kwh+1e-8);
      expect(s.total!).toBeLessThanOrEqual(b.total!+1e-8);
      expect(b.total!-s.total!).toBeCloseTo((baseline.kwh-short.kwh)*.2,8);
    }
  });
  it('accounts explicitly for real HP/HC shifting: shorter comfort can save kWh but cost more',()=>{
    const i=scheduleInput(),baseline=simulateSeason(i),short=simulateSeason({...i,schedule:shortened(i.schedule)});
    const profile={...newProfile('hp','HPHC','hphc'),hp:.25,hc:.12,subscription:12};
    const b=evaluateTariff(baseline,profile,1500),s=evaluateTariff(short,profile,1500);
    const bp=hpHcBreakdown(baseline),sp=hpHcBreakdown(short);
    const hpSaved=bp.hp.kwh-sp.hp.kwh,hcSaved=bp.hc.kwh-sp.hc.kwh;
    expect(baseline.kwh).toBeCloseTo(bp.hp.kwh+bp.hc.kwh,8);
    expect(short.kwh).toBeCloseTo(sp.hp.kwh+sp.hc.kwh,8);
    expect(b.energy!).toBeCloseTo(bp.hp.euros+bp.hc.euros,8);
    expect(s.energy!).toBeCloseTo(sp.hp.euros+sp.hc.euros,8);
    expect(baseline.kwh-short.kwh).toBeCloseTo(hpSaved+hcSaved,8);
    expect(b.total!-s.total!).toBeCloseTo(hpSaved*.25+hcSaved*.12,8);
    expect(hpSaved).toBeLessThan(0);expect(hcSaved).toBeGreaterThan(0);
    expect(baseline.kwh-short.kwh).toBeGreaterThan(0);
    expect(b.total!-s.total!).toBeLessThan(0);
  });
});
describe('seasonal RC consumption',()=>{
  it('balances steady heating and exactly integrates a constant outdoor / setpoint case',()=>{
    const result=simulateSeason(input());
    expect(result.hours).toHaveLength(212*24);
    expect(result.kwh).toBeCloseTo(40*15*result.hours.length/1000,6);
    expect(result.averagePower).toBeCloseTo(600,6);
    expect(result.comfortRate).toBe(100);
    expect(result.hours.every(h=>Math.abs(h.indoor-20)<1e-8)).toBe(true);
    expect(result.days[0]).toMatchObject({date:'2021-10-01',weekday:4});
    expect(result.days.at(-1)?.date).toBe('2022-04-30');
  });
  it('clips power and loses comfort without inventing energy',()=>{
    const result=simulateSeason({...input(),ratedPower:100});
    expect(result.hours.every(h=>h.kwh<=.10000001)).toBe(true);
    expect(result.comfortRate).toBeLessThan(5);
    expect(result.hours.at(-1)!.indoor).toBeCloseTo(7.5,2);
  });
  it('has a stable exact solution at very high UA / low inertia',()=>{
    const result=simulateSeason({...input(),ua:100000,inertia:'light',area:1});
    expect(result.hours.every(h=>Number.isFinite(h.indoor)&&h.indoor>=5)).toBe(true);
  });
  it('keeps temperatures usable without prices; all cost outputs are unavailable',()=>{
    const consumption=simulateSeason(input()),result=evaluateTariff(consumption,newProfile('x',''),2000);
    expect(consumption.hours[0].indoor).toBeCloseTo(20);
    expect(result.kwh).toBeGreaterThan(0);
    expect(result.total).toBeNull();expect(result.energy).toBeNull();expect(result.subscription).toBeNull();
    expect(result.monthly.every(m=>m.energy===null&&m.total===null)).toBe(true);
    expect(result.typical.every(h=>h.price===null)).toBe(true);
  });
  it('handles no comfort hours, omitted months, and rejects invalid / empty seasons',()=>{
    const i=input(),schedule={...i.schedule,weekdays:Array(24).fill(false),weekends:Array(24).fill(false)};
    expect(simulateSeason({...i,schedule}).comfortRate).toBeNull();
    expect(simulateSeason({...i,climate:{...i.climate,months:i.climate.months.slice(0,1)}}).days).toHaveLength(31);
    expect(()=>simulateSeason({...i,ua:NaN})).toThrow('billing.invalidModel');
    expect(()=>simulateSeason({...i,schedule:{...schedule,eco:21}})).toThrow('billing.invalidModel');
    expect(()=>simulateSeason({...i,climate:{...i.climate,months:[]}})).toThrow('billing.invalidClimate');
    expect(()=>simulateSeason({...i,climate:{...i.climate,months:[i.climate.months[0],i.climate.months[0]]}})).toThrow('billing.invalidClimate');
  });
  it('uses displayed heat loss first, falling back only for invalid calibration',()=>{
    expect(calibratedUA(300,20,5,40)).toBe(20);
    expect(calibratedUA(undefined,20,5,40)).toBe(40);
    expect(calibratedUA(300,5,5,40)).toBe(40);
    expect(calibratedUA(NaN,20,5,40)).toBe(40);
    expect(calibratedUA(undefined,20,5,NaN)).toBeNaN();
  });
  it('uses editable defaults with a 06:00 minimum, 15:00 maximum',()=>{
    expect(outdoorTemperature(8,4,6)).toBe(4);
    expect(outdoorTemperature(8,4,15)).toBe(12);
    const schedule=defaultSchedule(21);
    expect(schedule.comfort).toBe(21);expect(schedule.eco).toBe(16);
    expect(schedule.weekdays.filter(Boolean)).toHaveLength(8);
    expect(schedule.weekends.filter(Boolean)).toHaveLength(15);
  });
});
describe('tariff evaluation on shared consumption',()=>{
  it('classifies midnight-crossing and two separate HC periods with exclusive ends',()=>{
    const night=[{start:'22:00',end:'06:00'}],split=[{start:'01:00',end:'07:00'},{start:'12:00',end:'14:00'}];
    expect([21,22,0,5,6].map(h=>isOffPeak(h,night))).toEqual([false,true,true,true,false]);
    expect([0,1,6,7,11,12,13,14].map(h=>isOffPeak(h,split))).toEqual([false,true,true,false,false,true,true,false]);
    expect(validPeriods([{start:'22:30',end:'06:00'}])).toBe(false);
    expect(validPeriods([...split,...night])).toBe(false);
    expect(validPeriods([{start:'12:00',end:'12:00'}])).toBe(false);
  });
  it('charges HP/HC correctly and rejects malformed periods',()=>{
    const c=simulateSeason(input()),p={...base(),kind:'hphc' as const,hp:.3,hc:.1};
    const r=evaluateTariff(c,p,2000);
    expect(r.energy).toBeCloseTo(212*.6*(16*.3+8*.1),6);
    expect(r.typical[0].period).toBe('hc');expect(r.typical[6].period).toBe('hp');
    expect(evaluateTariff(c,{...p,periods:[{start:'bad',end:'06:00'}]},2000).error).toBe('billing.invalidPeriods');
  });
  it('assigns Tempo red only to Nov–Mar weekdays and clamps counts',()=>{
    const c=simulateSeason(input()),days={blue:147,white:43,red:22},colours=assignTempo(c.days,days);
    expect(colours.filter(v=>v==='red')).toHaveLength(22);
    expect(colours.filter(v=>v==='white')).toHaveLength(43);
    expect(colours.filter(v=>v==='blue')).toHaveLength(147);
    expect(c.days.every((d,i)=>colours[i]!=='red'||(d.weekday<5&&[11,12,1,2,3].includes(d.month)))).toBe(true);
    const clamped=assignTempo(c.days,{blue:0,white:999,red:999});
    const eligible=c.days.filter(d=>d.weekday<5&&[11,12,1,2,3].includes(d.month)).length;
    expect(clamped.filter(v=>v==='red')).toHaveLength(eligible);
    expect(clamped.filter(v=>v==='white')).toHaveLength(c.days.length-eligible);
    const ranked=assignTempo([{date:'2021-11-01',month:11,weekday:0,mean:5},{date:'2021-11-02',month:11,weekday:1,mean:0},{date:'2021-10-01',month:10,weekday:4,mean:-4}],{red:1,white:1,blue:1});
    expect(ranked).toEqual(['blue','red','white']);
  });
  it('computes all six Tempo prices and the colour cost split',()=>{
    const c=simulateSeason(input()),p={...base(),kind:'tempo' as const,tempo:{blue:{hp:.1,hc:.05},white:{hp:.2,hc:.1},red:{hp:.8,hc:.2}}};
    const r=evaluateTariff(c,p,2000);
    expect(r.split.red.days).toBe(22);
    expect(r.energy).toBeCloseTo(r.split.blue.energy!+r.split.white.energy!+r.split.red.energy!,8);
    expect(r.energy).toBeCloseTo(.6*(147*(16*.1+8*.05)+43*(16*.2+8*.1)+22*(16*.8+8*.2)),6);
    expect(evaluateTariff(c,{...p,tempo:{...p.tempo,red:{hp:null,hc:.2}}},2000).energy).toBeNull();
  });
  it('uses a Monday-first 24×7 custom grid and requires all entries',()=>{
    const p={...base(),kind:'custom' as const,grid:Array.from({length:7},(_,d)=>Array.from({length:24},(_,h)=>d+.01*h))};
    expect(rateAt(p,{month:10,weekday:4,date:'2021-10-01',mean:5},12).price).toBe(4.12);
    const c=simulateSeason(input()),r=evaluateTariff(c,p,2000);
    const expected=c.hours.reduce((sum,h)=>sum+h.kwh*p.grid[c.days[h.day].weekday][h.hour],0);
    expect(r.energy).toBeCloseTo(expected,6);
    p.grid[0][0]=NaN;expect(evaluateTariff(c,p,2000).energy).toBeNull();
  });
  it('compares profiles without changing consumption, including subscription and kVA warnings',()=>{
    const c=simulateSeason(input()),p=base(),cheap={...p,id:'cheap',base:.1,subscription:0,kva:1};
    const before=JSON.stringify(c),r=compareTariffs(c,[p,cheap,newProfile('empty','')],2000);
    expect(r[0].subscription).toBe(70);expect(r[0].total).toBeCloseTo(c.kwh*.2+70,6);
    expect(r[0].monthly.reduce((sum,m)=>sum+m.total!,0)).toBeCloseTo(r[0].total!,6);
    expect(r[0].perArea).toBeCloseTo(r[0].total!/20,6);
    expect(r[1].cheapest).toBe(true);expect(r[1].kvaWarning).toBe(true);
    expect(r[0].cheapest).toBe(false);expect(r[2].cheapest).toBe(false);
    expect(JSON.stringify(c)).toBe(before);
  });
  it('round trips profiles, active type, climate and schedule; recovers corrupt storage',()=>{
    const settings=restoreSettings(null,21);
    settings.profiles.push({...base(),kind:'tempo',id:'tempo'});settings.active='tempo';
    expect(restoreSettings(JSON.stringify(settings),19)).toEqual(settings);
    for(const invalid of ['{','null','{}',JSON.stringify({...settings,profiles:[{kind:'custom'}]})]){
      expect(restoreSettings(invalid,22).schedule.comfort).toBe(22);
    }
  });
  it('accepts explicit zero rates but not negative or incomplete prices',()=>{
    const c=simulateSeason(input()),p={...base(),base:0,subscription:0};
    expect(evaluateTariff(c,p,2000).total).toBe(0);
    expect(evaluateTariff(c,{...p,base:-.1},2000).energy).toBeNull();
    expect(evaluateTariff(c,{...p,subscription:null},2000).total).toBeNull();
    expect(evaluateTariff(c,{...p,kva:0},2000).kvaWarning).toBe(true);
  });
  it('allows an editable effective capacity override without changing UA',()=>{
    const i={...input(),ratedPower:100};
    const light=simulateSeason({...i,capacityPerArea:1000}),heavy=simulateSeason({...i,capacityPerArea:10000000});
    expect(light.hours[10].indoor).toBeLessThan(heavy.hours[10].indoor);
    expect(()=>simulateSeason({...i,capacityPerArea:0})).toThrow('billing.invalidModel');
  });
  it('simulates and evaluates a full season in less than 50 ms (median of 7)',()=>{
    const times:number[]=[];
    for(let i=0;i<7;i++){const start=performance.now();const c=simulateSeason(input());evaluateTariff(c,base(),2000);times.push(performance.now()-start);}
    const median=times.sort((a,b)=>a-b)[3];console.log('RC full-season + Base evaluation median:',median.toFixed(2),'ms');
    expect(median).toBeLessThan(50);
  });
});
