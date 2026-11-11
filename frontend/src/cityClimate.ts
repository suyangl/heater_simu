import {Climate,SEASON_MONTHS} from './billing';
import {Language} from './i18n';

export type City={id:number;name:string;latitude:number;longitude:number;country_code?:string;country?:string;admin1?:string};
export type MonthlyClimate={startYear:number;endYear:number;means:Record<number,number>};
type Storage=Pick<globalThis.Storage,'getItem'|'setItem'>;
export const CITY_CLIMATE_CACHE='heatsimu.city-climate.v1';
export const cityName=(city:City)=>[city.name,city.admin1,city.country||city.country_code].filter(Boolean).join(', ');
export function completeYears(now=new Date()) {
  const endYear=now.getUTCFullYear()-1;return {startYear:endYear-9,endYear};
}
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
function validCity(value:unknown):value is City {
  const c=value as City;
  return !!c&&Number.isInteger(c.id)&&typeof c.name==='string'&&!!c.name&&finite(c.latitude)&&Math.abs(c.latitude)<=90&&
    finite(c.longitude)&&Math.abs(c.longitude)<=180&&['country_code','country','admin1'].every(k=>c[k as keyof City]===undefined||typeof c[k as keyof City]==='string');
}
export function aggregateMonthly(data:unknown,startYear:number,endYear:number):MonthlyClimate {
  const daily=(data as {daily?:{time?:unknown[];temperature_2m_mean?:unknown[]}})?.daily;
  const times=daily?.time,values=daily?.temperature_2m_mean;
  const start=Date.UTC(startYear,0,1),end=Date.UTC(endYear+1,0,1),day=86400000;
  if(!Array.isArray(times)||!Array.isArray(values)||times.length!==(end-start)/day||values.length!==times.length)throw Error('climate.invalid');
  const sums:Record<number,number>={},counts:Record<number,number>={};
  times.forEach((time,i)=>{
    const expected=new Date(start+i*day).toISOString().slice(0,10);
    if(time!==expected)throw Error('climate.invalid');
    const month=Number(expected.slice(5,7));
    if(SEASON_MONTHS.includes(month)){
      const value=values[i];if(!finite(value))throw Error('climate.invalid');
      sums[month]=(sums[month]??0)+value;counts[month]=(counts[month]??0)+1;
    }
  });
  return {startYear,endYear,means:Object.fromEntries(SEASON_MONTHS.map(month=>[month,Math.round(sums[month]/counts[month]*10)/10]))};
}
export function fillCityClimate(climate:Climate,data:MonthlyClimate,city:City):Climate {
  return {...climate,months:climate.months.map(m=>({...m,mean:data.means[m.month]})),
    source:{city:cityName(city),startYear:data.startYear,endYear:data.endYear}};
}
function browserStorage():Storage|undefined {try{return localStorage;}catch{return undefined;}}
export function createCityClimateClient(fetcher:typeof fetch=fetch,storage:Storage|undefined=browserStorage(),now:()=>Date=()=>new Date()) {
  async function json(url:URL) {
    const response=await fetcher(url.toString(),{signal:AbortSignal.timeout(45000)});
    if(!response.ok)throw Error('climate.failed');
    const data=await response.json();if(data?.error)throw Error('climate.failed');
    return data;
  }
  async function search(name:string,language:Language):Promise<City[]> {
    if(name.trim().length<2)return [];
    const url=new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.search=new URLSearchParams({name:name.trim(),count:'50',language,format:'json'}).toString();
    const data=await json(url);
    if(data.results===undefined)return [];
    if(!Array.isArray(data.results)||!data.results.every(validCity))throw Error('climate.invalid');
    return [...data.results].sort((a:City,b:City)=>Number(b.country_code==='FR')-Number(a.country_code==='FR'));
  }
  async function load(city:City):Promise<MonthlyClimate> {
    if(!validCity(city))throw Error('climate.invalid');
    const {startYear,endYear}=completeYears(now());
    const key=[CITY_CLIMATE_CACHE,city.id,city.latitude,city.longitude,startYear,endYear].join(':');
    try {
      const saved=JSON.parse(storage?.getItem(key)??'null');
      if(saved?.startYear===startYear&&saved?.endYear===endYear&&SEASON_MONTHS.every(m=>finite(saved.means?.[m])))return saved;
    }catch{}
    const url=new URL('https://archive-api.open-meteo.com/v1/archive');
    url.search=new URLSearchParams({latitude:String(city.latitude),longitude:String(city.longitude),
      start_date:`${startYear}-01-01`,end_date:`${endYear}-12-31`,daily:'temperature_2m_mean',timezone:'auto',temperature_unit:'celsius',models:'era5'}).toString();
    const data=aggregateMonthly(await json(url),startYear,endYear);
    try{storage?.setItem(key,JSON.stringify(data));}catch{}
    return data;
  }
  return {search,load};
}
