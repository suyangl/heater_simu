import {describe,it,expect,vi} from 'vitest';
import {createCityClimateClient,aggregateMonthly,completeYears,fillCityClimate,City} from './cityClimate';
import {defaultClimate,restoreSettings} from './billing';

const city:City={id:2996944,name:'Lyon',latitude:45.74846,longitude:4.84671,country_code:'FR'};
const now=()=>new Date('2026-11-10T12:00:00Z');
function daily(startYear=2016,endYear=2025) {
  const time:string[]=[],temperature_2m_mean:number[]=[];
  for(let d=Date.UTC(startYear,0,1);d<Date.UTC(endYear+1,0,1);d+=86400000){
    const date=new Date(d);time.push(date.toISOString().slice(0,10));
    temperature_2m_mean.push(date.getUTCMonth()+1);
  }
  return {daily:{time,temperature_2m_mean}};
}
const response=(data:unknown)=>new Response(JSON.stringify(data),{status:200});
function memory() {
  const data=new Map<string,string>();return {getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},data};
}
describe('Open-Meteo city climate',()=>{
  it('uses the last ten complete calendar years, including at the year boundary',()=>{
    expect(completeYears(now())).toEqual({startYear:2016,endYear:2025});
    expect(completeYears(new Date('2025-01-01T00:00:00Z'))).toEqual({startYear:2015,endYear:2024});
  });
  it('fetches only on explicit calls; searches in UI language, prioritising France without excluding other countries',async()=>{
    const fetcher=vi.fn().mockResolvedValue(response({results:[{...city,id:2,country_code:'CA'},city]}));
    const client=createCityClimateClient(fetcher,memory(),now);
    expect(fetcher).not.toHaveBeenCalled();
    const results=await client.search(' Lyon ','zh'),url=new URL(fetcher.mock.calls[0][0]);
    expect(url.origin+url.pathname).toBe('https://geocoding-api.open-meteo.com/v1/search');
    expect(url.searchParams.get('language')).toBe('zh');expect(url.searchParams.get('name')).toBe('Lyon');
    expect(url.searchParams.has('countryCode')).toBe(false);
    expect(results.map(c=>c.country_code)).toEqual(['FR','CA']);
    expect(await client.search(' ','en')).toEqual([]);expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('requests daily Celsius means for the documented archive date range and aggregates the seven heating months',async()=>{
    const fetcher=vi.fn().mockResolvedValue(response(daily()));
    const result=await createCityClimateClient(fetcher,memory(),now).load(city),url=new URL(fetcher.mock.calls[0][0]);
    expect(url.origin+url.pathname).toBe('https://archive-api.open-meteo.com/v1/archive');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({latitude:String(city.latitude),longitude:String(city.longitude),
      start_date:'2016-01-01',end_date:'2025-12-31',daily:'temperature_2m_mean',timezone:'auto',temperature_unit:'celsius',models:'era5'});
    expect(result.means).toEqual({10:10,11:11,12:12,1:1,2:2,3:3,4:4});
  });
  it('averages daily values, including leap days, instead of taking one year or summing monthly means',()=>{
    const data=daily();let sum=0,count=0;
    data.daily.time.forEach((date,i)=>{if(date.slice(5,7)==='02'){
      const value=Number(date.slice(0,4))-2000;data.daily.temperature_2m_mean[i]=value;sum+=value;count++;
    }});
    expect(count).toBe(283);expect(aggregateMonthly(data,2016,2025).means[2]).toBe(Math.round(sum/count*10)/10);
  });
  it('caches per city/coordinates/year range, survives client recreation, and refreshes next year',async()=>{
    const storage=memory(),fetcher=vi.fn().mockImplementation(async()=>response(daily()));
    const first=await createCityClimateClient(fetcher,storage,now).load(city);
    expect(await createCityClimateClient(fetcher,storage,now).load(city)).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await createCityClimateClient(fetcher,storage,now).load({...city,id:2,latitude:46});
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockResolvedValueOnce(response(daily(2017,2026)));
    await createCityClimateClient(fetcher,storage,()=>new Date('2027-01-01T00:00:00Z')).load(city);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('recovers from corrupt cache and unavailable localStorage without losing a valid API result',async()=>{
    const storage=memory(),fetcher=vi.fn().mockImplementation(async()=>response(daily()));
    await createCityClimateClient(fetcher,storage,now).load(city);
    storage.data.set([...storage.data.keys()][0],'{broken');
    await createCityClimateClient(fetcher,storage,now).load(city);expect(fetcher).toHaveBeenCalledTimes(2);
    const denied={getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('full');}};
    expect((await createCityClimateClient(fetcher,denied,now).load(city)).means[1]).toBe(1);
  });
  it('handles empty results, network errors, HTTP errors, API errors and malformed responses without caching failures',async()=>{
    const storage=memory();
    expect(await createCityClimateClient(vi.fn().mockResolvedValue(response({})),storage,now).search('Lyon','en')).toEqual([]);
    for(const fetcher of [
      vi.fn().mockRejectedValue(Error('offline')),
      vi.fn().mockResolvedValue(new Response('unavailable',{status:503})),
      vi.fn().mockResolvedValue(response({error:true,reason:'invalid'})),
      vi.fn().mockResolvedValue(response({daily:{}})),
      vi.fn().mockResolvedValue(new Response('{broken'))
    ])await expect(createCityClimateClient(fetcher,storage,now).load(city)).rejects.toThrow();
    await expect(createCityClimateClient(vi.fn().mockResolvedValue(response({results:[{}]})),storage,now).search('Lyon','en')).rejects.toThrow();
    expect(storage.data.size).toBe(0);expect(defaultClimate().months[0].mean).toBe(12.5);
  });
  it('rejects partial, duplicate-date and unavailable heating-month data rather than overwriting inputs with biased means',()=>{
    const incomplete=daily();incomplete.daily.time.pop();expect(()=>aggregateMonthly(incomplete,2016,2025)).toThrow();
    const duplicate=daily();duplicate.daily.time[1]=duplicate.daily.time[0];expect(()=>aggregateMonthly(duplicate,2016,2025)).toThrow();
    const missing=daily();(missing.daily.temperature_2m_mean as unknown[])[0]=null;expect(()=>aggregateMonthly(missing,2016,2025)).toThrow();
  });
  it('fills only monthly means, preserves editable settings, and persists source with billing settings',()=>{
    const climate=defaultClimate();climate.months[0].enabled=false;climate.amplitude=6;
    const updated=fillCityClimate(climate,aggregateMonthly(daily(),2016,2025),city);
    expect(updated.months[0]).toEqual({month:10,mean:10,enabled:false});expect(updated.amplitude).toBe(6);
    expect(climate.months[0].mean).toBe(12.5);
    expect(updated.source).toEqual({city:'Lyon, FR',startYear:2016,endYear:2025});
    const settings=restoreSettings(null,19);settings.climate=updated;
    expect(restoreSettings(JSON.stringify(settings),19).climate).toEqual(updated);
    settings.climate.source={city:'Lyon',startYear:0,endYear:2025};
    const restored=restoreSettings(JSON.stringify(settings),19);
    expect(restored.climate.source).toBeUndefined();expect(restored.climate.months[0].mean).toBe(10);
  });
});
