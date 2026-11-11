export type Price = number|null;
export type Period = {start:string;end:string};
export type Colour = 'blue'|'white'|'red';
export type TariffKind = 'base'|'hphc'|'tempo'|'custom';
export type Profile = {
  id:string;name:string;kind:TariffKind;subscription:Price;kva:Price;
  base:Price;hp:Price;hc:Price;periods:Period[];
  tempo:Record<Colour,{hp:Price;hc:Price}>;days:Record<Colour,number>;
  grid:Price[][];
};
export type Climate = {months:{month:number;mean:number;enabled:boolean}[];amplitude:number;
  source?:{city:string;startYear:number;endYear:number;edited?:boolean}};
export type Schedule = {comfort:number;eco:number;weekdays:boolean[];weekends:boolean[]};
export type Inertia = 'light'|'medium'|'heavy';
// Effective fabric + contents capacity, J/(m² floor·K), not air capacity alone.
export const CAPACITY = {light:80000,medium:165000,heavy:260000};
export const SEASON_MONTHS = [10,11,12,1,2,3,4];
export function defaultClimate():Climate {
  return {months:SEASON_MONTHS.map((month,i)=>({month,mean:[12.5,8,5.5,4.9,5.6,8.8,11.5][i],enabled:true})),amplitude:4};
}
export function defaultSchedule(comfort:number):Schedule {
  return {comfort,eco:16,weekdays:Array.from({length:24},(_,h)=>(h>=7&&h<9)||(h>=17&&h<23)),
    weekends:Array.from({length:24},(_,h)=>h>=8&&h<23)};
}
export function newProfile(id:string,name:string,kind:TariffKind='base'):Profile {
  return {id,name,kind,subscription:null,kva:null,base:null,hp:null,hc:null,
    periods:[{start:'22:00',end:'06:00'}],tempo:{blue:{hp:null,hc:null},white:{hp:null,hc:null},red:{hp:null,hc:null}},
    days:{blue:147,white:43,red:22},grid:Array.from({length:7},()=>Array<Price>(24).fill(null))};
}
export function calibratedUA(heatLoss:number|undefined,setpoint:number,outdoor:number,analytic:number) {
  const value=heatLoss!==undefined&&Number.isFinite(heatLoss)&&heatLoss>0&&setpoint>outdoor?heatLoss/(setpoint-outdoor):analytic;
  return Number.isFinite(value)&&value>0?value:NaN;
}
export type Day = {date:string;month:number;weekday:number;mean:number};
export type Hour = {day:number;hour:number;kwh:number;indoor:number;outdoor:number;comfort:boolean};
export type Consumption = {days:Day[];hours:Hour[];kwh:number;averagePower:number;comfortRate:number|null;area:number};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const price=(v:unknown):v is number=>finite(v)&&v>=0;
export function outdoorTemperature(mean:number,amplitude:number,hour:number) {
  const phase=(hour-6+24)%24;
  return mean+amplitude*(phase<9?-Math.cos(Math.PI*phase/9):Math.cos(Math.PI*(phase-9)/15));
}
export function simulateSeason(input:{ua:number;area:number;ratedPower:number;inertia:Inertia;capacityPerArea?:number;climate:Climate;schedule:Schedule}):Consumption {
  const {ua,area,ratedPower,inertia,climate,schedule}=input;
  if(!finite(ua)||ua<=0||!finite(area)||area<=0||!finite(ratedPower)||ratedPower<=0||
      !Object.hasOwn(CAPACITY,inertia)||(input.capacityPerArea!==undefined&&(!finite(input.capacityPerArea)||input.capacityPerArea<=0))||!finite(climate.amplitude)||climate.amplitude<0||
      !finite(schedule.comfort)||!finite(schedule.eco)||schedule.comfort<schedule.eco||
      ![schedule.weekdays,schedule.weekends].every(row=>row.length===24&&row.every(v=>typeof v==='boolean')))
    throw Error('billing.invalidModel');
  const months=climate.months.filter(m=>m.enabled);
  if(!months.length||months.some(m=>!SEASON_MONTHS.includes(m.month)||!finite(m.mean))||
      new Set(months.map(m=>m.month)).size!==months.length)throw Error('billing.invalidClimate');
  const days:Day[]=[],hours:Hour[]=[];
  for(const month of SEASON_MONTHS){
    const climateMonth=months.find(m=>m.month===month);if(!climateMonth)continue;
    const year=month>=10?2021:2022,count=new Date(Date.UTC(year,month,0)).getUTCDate();
    for(let d=1;d<=count;d++){
      const date=new Date(Date.UTC(year,month-1,d));
      days.push({date:date.toISOString().slice(0,10),month,weekday:(date.getUTCDay()+6)%7,mean:climateMonth.mean});
    }
  }
  const capacity=(input.capacityPerArea??CAPACITY[inertia])*area,lossFraction=-Math.expm1(-ua*3600/capacity);
  // Common warm start for eco/pattern comparisons; no scenario-specific stored heat.
  let indoor=schedule.comfort;
  let total=0,comfortHours=0,comfortable=0;
  for(let day=0;day<days.length;day++)for(let hour=0;hour<24;hour++){
    const comfort=(days[day].weekday>=5?schedule.weekends:schedule.weekdays)[hour];
    const target=comfort?schedule.comfort:schedule.eco;
    const outdoor=outdoorTemperature(days[day].mean,climate.amplitude,hour+.5);
    // Exact constant-forcing RC solution: stable for any positive UA/C.
    const free=indoor+(outdoor-indoor)*lossFraction;
    const power=Math.max(0,Math.min(ratedPower,ua*(target-free)/lossFraction));
    indoor=free+power/ua*lossFraction;
    const kwh=power/1000;total+=kwh;
    if(comfort){comfortHours++;if(indoor>=schedule.comfort-.5-1e-9)comfortable++;}
    hours.push({day,hour,kwh,indoor,outdoor,comfort});
  }
  return {days,hours,kwh:total,averagePower:total*1000/hours.length,
    comfortRate:comfortHours?comfortable/comfortHours*100:null,area};
}
function clock(value:string) {
  return /^(?:[01]\d|2[0-3]):00$/.test(value)?Number(value.slice(0,2)):NaN;
}
export function validPeriods(periods:Period[]) {
  return periods.length<=2&&periods.every(p=>finite(clock(p.start))&&finite(clock(p.end))&&clock(p.start)!==clock(p.end));
}
export function isOffPeak(hour:number,periods:Period[]) {
  return periods.some(p=>{const a=clock(p.start),b=clock(p.end);return a<b?hour>=a&&hour<b:hour>=a||hour<b;});
}
export function assignTempo(days:Day[],requested:Record<Colour,number>) {
  const colours:Colour[]=days.map(()=>'blue');
  const ranked=days.map((day,i)=>({day,i})).sort((a,b)=>a.day.mean-b.day.mean||a.day.date.localeCompare(b.day.date));
  const count=(v:number)=>finite(v)?Math.max(0,Math.floor(v)):0;
  let red=count(requested.red),white=count(requested.white);
  for(const {day,i} of ranked)if(red>0&&day.weekday<5&&[11,12,1,2,3].includes(day.month)){colours[i]='red';red--;}
  for(const {i} of ranked)if(white>0&&colours[i]==='blue'){colours[i]='white';white--;}
  return colours;
}
export type TariffPeriod = 'base'|'hp'|'hc'|'custom'|`${Colour}_hp`|`${Colour}_hc`;
export function rateAt(profile:Profile,day:Day,hour:number,colour:Colour='blue'):{price:Price;period:TariffPeriod} {
  if(profile.kind==='base')return {price:profile.base,period:'base'};
  if(profile.kind==='custom')return {price:profile.grid[day.weekday]?.[hour]??null,period:'custom'};
  const period=isOffPeak(hour,profile.periods)?'hc':'hp';
  return profile.kind==='hphc'?{price:profile[period],period}:{price:profile.tempo[colour][period],period:`${colour}_${period}`};
}
export function tariffError(p:Profile):string|null {
  if(!price(p.subscription))return 'billing.missingPrices';
  if((p.kind==='hphc'||p.kind==='tempo')&&!validPeriods(p.periods))return 'billing.invalidPeriods';
  const values=p.kind==='base'?[p.base]:p.kind==='hphc'?[p.hp,p.hc]:p.kind==='tempo'?
    Object.values(p.tempo).flatMap(v=>[v.hp,v.hc]):p.grid.length===7&&p.grid.every(row=>row.length===24)?p.grid.flat():[null];
  return values.every(price)?null:'billing.missingPrices';
}
export function evaluateTariff(consumption:Consumption,profile:Profile,ratedPower:number) {
  const error=tariffError(profile),colours=assignTempo(consumption.days,profile.days);
  const monthly=SEASON_MONTHS.filter(month=>consumption.days.some(d=>d.month===month)).map(month=>({month,kwh:0,energy:0,total:0}));
  const split:Record<Colour,{days:number;kwh:number;energy:number}>={blue:{days:0,kwh:0,energy:0},white:{days:0,kwh:0,energy:0},red:{days:0,kwh:0,energy:0}};
  for(const c of colours)split[c].days++;
  const typical=Array.from({length:24},(_,hour)=>({hour,power:0,price:0,period:'base' as TariffPeriod,mixed:false}));
  const frequencies=typical.map(()=>new Map<TariffPeriod,number>());
  let energy=0;
  for(const sample of consumption.hours){
    const day=consumption.days[sample.day],colour=colours[sample.day],rate=rateAt(profile,day,sample.hour,colour);
    const cost=error?0:sample.kwh*rate.price!;
    const month=monthly.find(m=>m.month===day.month)!;month.kwh+=sample.kwh;month.energy+=cost;
    split[colour].kwh+=sample.kwh;split[colour].energy+=cost;energy+=cost;
    const typicalHour=typical[sample.hour];typicalHour.power+=sample.kwh*1000;typicalHour.price+=error?0:rate.price!;
    const f=frequencies[sample.hour];f.set(rate.period,(f.get(rate.period)??0)+1);
  }
  const subscription=error?null:profile.subscription!*monthly.length;
  for(const m of monthly)m.total=m.energy+(error?0:profile.subscription!);
  for(const h of typical){
    h.power/=consumption.days.length;h.price/=consumption.days.length;
    h.period=[...frequencies[h.hour]].sort((a,b)=>b[1]-a[1])[0]?.[0]??'base';h.mixed=frequencies[h.hour].size>1;
  }
  return {id:profile.id,error,kwh:consumption.kwh,energy:error?null:energy,subscription,total:error?null:energy+subscription!,
    perArea:error?null:(energy+subscription!)/consumption.area,
    monthly:monthly.map(m=>({...m,energy:error?null:m.energy,total:error?null:m.total})),
    typical:typical.map(h=>({...h,price:error?null:h.price})),
    split:{blue:{...split.blue,energy:error?null:split.blue.energy},white:{...split.white,energy:error?null:split.white.energy},red:{...split.red,energy:error?null:split.red.energy}},
    kvaWarning:finite(profile.kva)&&profile.kva>=0&&ratedPower/1000>profile.kva};
}
export function compareTariffs(consumption:Consumption,profiles:Profile[],ratedPower:number) {
  const results=profiles.map(p=>evaluateTariff(consumption,p,ratedPower));
  const available=results.flatMap(r=>r.total===null?[]:[r.total]);
  const minimum=available.length?Math.min(...available):null;
  return results.map(r=>({...r,cheapest:r.total!==null&&r.total===minimum}));
}
export type BillingSettings = {version:1;profiles:Profile[];active:string;climate:Climate;schedule:Schedule;inertia:Inertia;capacityPerArea:number|null;followProject:boolean;envelope?:{windowFactor:number;achFactor:number}};
export const BILLING_STORAGE = 'heatsimu.billing.v1';
export function restoreSettings(raw:string|null,comfort:number):BillingSettings {
  const fallback:BillingSettings={version:1,profiles:[newProfile('base','', 'base')],active:'base',
    climate:defaultClimate(),schedule:defaultSchedule(comfort),inertia:'medium',capacityPerArea:null,followProject:true};
  if(!raw)return fallback;
  try{
    const s=JSON.parse(raw) as BillingSettings;
    const storedPrice=(v:unknown)=>v===null||finite(v);
    const validProfile=(p:Profile)=>p&&typeof p.id==='string'&&typeof p.name==='string'&&
      ['base','hphc','tempo','custom'].includes(p.kind)&&[p.subscription,p.kva,p.base,p.hp,p.hc].every(storedPrice)&&
      Array.isArray(p.periods)&&p.periods.length<=2&&p.periods.every(v=>v&&typeof v.start==='string'&&typeof v.end==='string')&&
      ['blue','white','red'].every(c=>{const colour=c as Colour;return p.tempo?.[colour]&&
        [p.tempo[colour].hp,p.tempo[colour].hc].every(storedPrice)&&finite(p.days?.[colour]);})&&
      Array.isArray(p.grid)&&p.grid.length===7&&p.grid.every(row=>Array.isArray(row)&&row.length===24&&row.every(storedPrice));
    if(s?.version!==1||!Array.isArray(s.profiles)||!s.profiles.length||!s.profiles.every(validProfile)||
        new Set(s.profiles.map(p=>p.id)).size!==s.profiles.length||!s.profiles.some(p=>p.id===s.active)||
        !Object.hasOwn(CAPACITY,s.inertia)||(s.capacityPerArea!==null&&!finite(s.capacityPerArea))||
        (s.envelope!==undefined&&![s.envelope.windowFactor,s.envelope.achFactor].every(v=>finite(v)&&v>0&&v<=1))||
        typeof s.followProject!=='boolean'||!finite(s.climate?.amplitude)||
        !Array.isArray(s.climate.months)||s.climate.months.length!==7||
        new Set(s.climate.months.map(m=>m.month)).size!==7||
        !s.climate.months.every(m=>SEASON_MONTHS.includes(m.month)&&finite(m.mean)&&typeof m.enabled==='boolean')||
        !finite(s.schedule?.comfort)||!finite(s.schedule.eco)||
        ![s.schedule.weekdays,s.schedule.weekends].every(row=>Array.isArray(row)&&row.length===24&&row.every(v=>typeof v==='boolean')))return fallback;
    const source=s.climate.source;
    if(source&&(typeof source.city!=='string'||!Number.isInteger(source.startYear)||!Number.isInteger(source.endYear)||
        source.endYear-source.startYear!==9||(source.edited!==undefined&&typeof source.edited!=='boolean')))delete s.climate.source;
    return s;
  }catch{return fallback;}
}
